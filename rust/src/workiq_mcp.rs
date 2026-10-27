//! Standalone User-Auth Microsoft 365 connector via the local WorkIQ MCP server.
//!
//! Speaks JSON-RPC 2.0 over stdio to `workiq mcp` (and supports direct CLI
//! `workiq fetch` calls) so the user can scan their Microsoft Teams chats and
//! Outlook emails using WorkIQ's built-in first-party authentication broker—
//! without registering an Entra application in admin app.

use std::collections::{HashSet, VecDeque};
use std::env;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::RwLock;
use std::time::Duration;

use chrono::{DateTime, Duration as ChronoDuration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::refresh_phase::RefreshPhase;
use crate::refresh_progress::RefreshProgress;
use crate::slop_detector::{M365App, MessageDirection, MessageSample};

/// Timeout for a single WorkIQ MCP or CLI subprocess invocation.
const WORKIQ_TIMEOUT: Duration = Duration::from_secs(25);

/// Status snapshot of the local WorkIQ MCP connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkIqStatus {
    /// Whether the `workiq` binary was located on the host.
    pub binary_found: bool,
    /// Resolved path to the `workiq` executable, if found.
    pub binary_path: Option<String>,
    /// Version string reported by `workiq version`.
    pub version: Option<String>,
    /// Whether the MCP stdio handshake (`initialize` + `tools/list`) succeeded.
    pub mcp_ready: bool,
    /// Number of MCP tools exposed by the user's WorkIQ server.
    pub mcp_tool_count: usize,
    /// Optional configured or detected M365 account email.
    pub account: Option<String>,
    /// Human-readable status or remediation hint (e.g., `"Run workiq auth login"`).
    pub message: String,
}

/// Client for interacting with the user's local WorkIQ MCP server.
pub struct WorkIqClient {
    binary_path: Option<PathBuf>,
    account: RwLock<Option<String>>,
}

impl WorkIqClient {
    /// Discover the local `workiq` executable and construct a [`WorkIqClient`].
    pub fn new(explicit_bin: Option<PathBuf>, account: Option<String>) -> Self {
        let binary_path = resolve_workiq_binary(explicit_bin);
        Self {
            binary_path,
            account: RwLock::new(account),
        }
    }

    /// Update the active M365 account hint passed to `--account`.
    pub fn set_account(&self, account: Option<String>) {
        if let Ok(mut guard) = self.account.write() {
            *guard = account.filter(|s| !s.trim().is_empty());
        }
    }

    /// Return the currently configured M365 account hint.
    pub fn account(&self) -> Option<String> {
        self.account.read().ok().and_then(|g| g.clone())
    }

    /// Probe the local WorkIQ installation and perform a non-destructive MCP `tools/list` handshake.
    pub async fn check_status(&self) -> WorkIqStatus {
        let Some(ref bin) = self.binary_path else {
            return WorkIqStatus {
                binary_found: false,
                binary_path: None,
                version: None,
                mcp_ready: false,
                mcp_tool_count: 0,
                account: self.account(),
                message: "WorkIQ CLI not found. Install @microsoft/workiq or set WORKIQ_BIN."
                    .to_string(),
            };
        };

        let version = self.query_version(bin).await;
        let display_bin = redact_user_path(bin);
        match self.probe_mcp_tools(bin).await {
            Ok(tool_count) => WorkIqStatus {
                binary_found: true,
                binary_path: Some(display_bin),
                version,
                mcp_ready: tool_count > 0,
                mcp_tool_count: tool_count,
                account: self.account(),
                message: format!(
                    "Connected to WorkIQ MCP ({tool_count} M365 tools registered; Standalone User-Auth registration required)."
                ),
            },
            Err(err) => WorkIqStatus {
                binary_found: true,
                binary_path: Some(display_bin),
                version,
                mcp_ready: false,
                mcp_tool_count: 0,
                account: self.account(),
                message: format!(
                    "WorkIQ binary found, but MCP probe failed ({err}). Run `workiq ask` to authenticate."
                ),
            },
        }
    }

    /// Trigger `workiq auth login` to authenticate the user with their M365 tenant.
    pub async fn start_interactive_login(&self) -> Result<String, String> {
        let Some(ref bin) = self.binary_path else {
            return Err("WorkIQ binary not found on this machine.".to_string());
        };
        let mut cmd = Command::new(bin);
        cmd.arg("auth").arg("login");
        if let Some(acct) = self.account() {
            cmd.arg("--account").arg(acct);
        }
        cmd.env_remove("NODE_OPTIONS");
        let output = tokio::time::timeout(Duration::from_secs(60), cmd.output())
            .await
            .map_err(|_| "WorkIQ login timed out after 60s".to_string())?
            .map_err(|e| format!("Failed to spawn workiq auth login: {e}"))?;

        if output.status.success() {
            Ok("WorkIQ M365 authentication succeeded.".to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Err(if !stderr.is_empty() { stderr } else { stdout })
        }
    }

    /// Poll recent sent and received Microsoft 365 messages (Outlook + Teams) via WorkIQ MCP `fetch`.
    pub async fn poll_recent_m365_messages(&self) -> Result<Vec<MessageSample>, String> {
        let Some(ref bin) = self.binary_path else {
            return Err("WorkIQ binary not configured".to_string());
        };

        let entity_urls = vec![
            "/me?$select=id,displayName,mail,userPrincipalName".to_string(),
            "/me/mailFolders/inbox/messages?$select=id,subject,from,bodyPreview,uniqueBody,body,receivedDateTime&$top=30".to_string(),
            "/me/mailFolders/sentitems/messages?$select=id,subject,from,bodyPreview,uniqueBody,body,sentDateTime&$top=30".to_string(),
            "/me/chats?$select=id,topic,chatType&$top=5".to_string(),
        ];

        let payload = self.call_mcp_fetch(bin, &entity_urls).await?;

        let mut samples = parse_workiq_fetch_bundle(&payload, self.account().as_deref());

        let me = extract_me_user_id(&payload)
            .or_else(|| extract_me_email(&payload))
            .or_else(|| self.account());
        for id in extract_chat_ids(&payload).into_iter().take(5) {
            let path = chat_messages_path(&id);
            let chat_payload = self
                .call_mcp_fetch(bin, &[format!("{path}?$top=10")])
                .await?;
            samples.extend(parse_chat_messages(&chat_payload, me.as_deref(), Some(&id)));
        }

        Ok(samples)
    }

    /// Fetch every page of non-draft mail and Teams chats in the last `days` days (`1..=30`).
    ///
    /// The window is fixed at request start. Historical edits and future-dated messages
    /// are excluded using each message's creation/receive timestamp.
    pub async fn poll_history(&self, days: u8) -> Result<Vec<MessageSample>, String> {
        self.poll_history_with_progress(days, |_| Ok(())).await
    }

    /// Fetch history while reporting metadata-only counters after every provider page.
    pub async fn poll_history_with_progress<P>(
        &self,
        days: u8,
        progress: P,
    ) -> Result<Vec<MessageSample>, String>
    where
        P: FnMut(RefreshProgress) -> Result<(), String>,
    {
        if !(1..=30).contains(&days) {
            return Err("lookbackDays must be between 1 and 30.".to_string());
        }
        let Some(ref bin) = self.binary_path else {
            return Err("WorkIQ binary not configured".to_string());
        };
        fetch_history_with_progress(
            days,
            self.account(),
            Utc::now(),
            |paths| async move { self.call_mcp_fetch(bin, &paths).await },
            progress,
        )
        .await
    }

    async fn query_version(&self, bin: &Path) -> Option<String> {
        let mut cmd = Command::new(bin);
        cmd.arg("version").env_remove("NODE_OPTIONS");
        let output = tokio::time::timeout(Duration::from_secs(8), cmd.output())
            .await
            .ok()?
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }

    async fn probe_mcp_tools(&self, bin: &Path) -> Result<usize, String> {
        let response = self
            .run_mcp_jsonrpc(bin, build_mcp_tools_list_request())
            .await?;
        let tools = response
            .get("result")
            .and_then(|r| r.get("tools"))
            .and_then(Value::as_array)
            .ok_or_else(|| "MCP response missing result.tools array".to_string())?;
        Ok(tools.len())
    }

    async fn call_mcp_fetch(&self, bin: &Path, entity_urls: &[String]) -> Result<Value, String> {
        let req = build_mcp_fetch_call_request(entity_urls);
        let response = self.run_mcp_jsonrpc(bin, req).await?;
        decode_mcp_fetch_response(response)
    }

    async fn run_mcp_jsonrpc(&self, bin: &Path, second_request: Value) -> Result<Value, String> {
        let mut cmd = Command::new(bin);
        cmd.arg("mcp").arg("--log-level").arg("Error");
        if let Some(acct) = self.account() {
            cmd.arg("--account").arg(acct);
        }
        cmd.env_remove("NODE_OPTIONS")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start workiq mcp: {e}"))?;

        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open workiq stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to open workiq stdout".to_string())?;
        let mut reader = BufReader::new(stdout).lines();

        let init_req = build_mcp_initialize_request();
        let initialized_notif = json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });

        let interact = async move {
            stdin
                .write_all(format!("{init_req}\n").as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            stdin.flush().await.map_err(|e| e.to_string())?;

            // Read lines until we get the JSON-RPC id=1 response
            while let Some(line) = reader.next_line().await.map_err(|e| e.to_string())? {
                if let Ok(val) = serde_json::from_str::<Value>(&line) {
                    if val.get("id") == Some(&json!(1)) {
                        break;
                    }
                }
            }

            stdin
                .write_all(format!("{initialized_notif}\n{second_request}\n").as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            stdin.flush().await.map_err(|e| e.to_string())?;

            while let Some(line) = reader.next_line().await.map_err(|e| e.to_string())? {
                if let Ok(val) = serde_json::from_str::<Value>(&line) {
                    if val.get("id") == Some(&json!(2)) {
                        return Ok(val);
                    }
                }
            }
            Err("WorkIQ MCP closed stream before responding to request #2".to_string())
        };

        tokio::time::timeout(WORKIQ_TIMEOUT, interact)
            .await
            .map_err(|_| "WorkIQ MCP request timed out".to_string())?
    }
}

/// Build the standard JSON-RPC 2.0 `initialize` request for `workiq mcp`.
pub fn build_mcp_initialize_request() -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "slop-grenade",
                "version": env!("CARGO_PKG_VERSION")
            }
        }
    })
}

/// Build the JSON-RPC 2.0 `tools/list` request for `workiq mcp`.
pub fn build_mcp_tools_list_request() -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {}
    })
}

/// Build the JSON-RPC 2.0 `tools/call` request invoking WorkIQ's `fetch` tool.
pub fn build_mcp_fetch_call_request(entity_urls: &[String]) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {
            "name": "fetch",
            "arguments": {
                "entityUrls": entity_urls
            }
        }
    })
}

fn relative_graph_url(url: &reqwest::Url) -> String {
    let mut path = url.path().to_string();
    if let Some(query) = url.query() {
        path.push('?');
        path.push_str(query);
    }
    path
}

fn chat_messages_path(chat_id: &str) -> String {
    let mut url = reqwest::Url::parse("https://graph.microsoft.com/me/chats/")
        .expect("fixed Microsoft Graph URL is valid");
    url.path_segments_mut()
        .expect("fixed Microsoft Graph URL has path segments")
        .pop_if_empty()
        .push(chat_id)
        .push("messages");
    relative_graph_url(&url)
}

async fn fetch_history_with_progress<F, Fut, P>(
    days: u8,
    account: Option<String>,
    until: DateTime<Utc>,
    mut fetch: F,
    mut observe: P,
) -> Result<Vec<MessageSample>, String>
where
    F: FnMut(Vec<String>) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
    P: FnMut(RefreshProgress) -> Result<(), String>,
{
    let since = until - ChronoDuration::days(i64::from(days));
    let cutoff = since.to_rfc3339_opts(SecondsFormat::Millis, true);
    let mut progress = RefreshProgress::new(days, None);
    observe(progress.clone())?;
    let identity = fetch(vec![
        "/me?$select=id,displayName,mail,userPrincipalName".to_string()
    ])
    .await
    .map_err(|error| format!("WorkIQ identity lookup failed: {error}"))?;
    let me_email = extract_me_email(&identity).or(account);
    let me = extract_me_user_id(&identity).or_else(|| me_email.clone());

    progress.phase = RefreshPhase::Outlook;
    observe(progress.clone())?;
    let mail = fetch_all_pages(
        history_mail_query(&cutoff),
        |path| fetch(vec![path]),
        |scanned, total, _| {
            progress.outlook_scanned = scanned;
            progress.outlook_total = total;
            observe(progress.clone())
        },
    )
    .await
    .map_err(|error| format!("Outlook history fetch failed: {error}"))?;
    let mut samples = parse_workiq_fetch_bundle(&mail, me_email.as_deref());

    progress.phase = RefreshPhase::Teams;
    observe(progress.clone())?;
    let chats = fetch_all_pages(
        history_chat_list_query(&cutoff),
        |path| fetch(vec![path]),
        |scanned, _, _| {
            progress.teams_chats_discovered = scanned;
            observe(progress.clone())
        },
    )
    .await
    .map_err(|error| format!("Teams chat list fetch failed: {error}"))?;
    let mut chat_ids = extract_chat_ids(&chats);
    let mut distinct = HashSet::new();
    chat_ids.retain(|id| distinct.insert(id.clone()));
    progress.teams_chats_total = Some(chat_ids.len());
    if chat_ids.is_empty() {
        progress.teams_total = Some(0);
    }
    observe(progress.clone())?;
    for (index, id) in chat_ids.iter().enumerate() {
        let previous = progress.teams_scanned;
        let last_chat = index + 1 == chat_ids.len();
        let messages = fetch_all_pages(
            history_chat_query(id, &cutoff),
            |path| fetch(vec![path]),
            |scanned, total, _| {
                progress.teams_scanned = previous + scanned;
                progress.teams_total = if last_chat {
                    total.map(|count| previous + count)
                } else {
                    None
                };
                observe(progress.clone())
            },
        )
        .await
        .map_err(|error| format!("Teams message history fetch failed: {error}"))?;
        samples.extend(parse_chat_messages(&messages, me.as_deref(), Some(id)));
        progress.teams_chats_scanned = index + 1;
        observe(progress.clone())?;
    }
    filter_history_samples(samples, since, until)
}

fn history_mail_query(since: &str) -> String {
    let mut url = reqwest::Url::parse("https://graph.microsoft.com/me/messages")
        .expect("fixed Microsoft Graph URL is valid");
    url.query_pairs_mut()
        .append_pair(
            "$select",
            "id,subject,from,bodyPreview,uniqueBody,body,receivedDateTime,sentDateTime,isDraft",
        )
        .append_pair("$top", "50")
        .append_pair("$count", "true")
        .append_pair(
            "$filter",
            &format!(
                "isDraft eq false and (receivedDateTime ge {since} or sentDateTime ge {since})"
            ),
        );
    relative_graph_url(&url)
}

fn history_chat_list_query(since: &str) -> String {
    let mut url = reqwest::Url::parse("https://graph.microsoft.com/me/chats")
        .expect("fixed Microsoft Graph URL is valid");
    // Membership updates are not message activity; filter on the latest message.
    url.query_pairs_mut()
        .append_pair("$expand", "lastMessagePreview")
        .append_pair("$orderby", "lastMessagePreview/createdDateTime desc")
        .append_pair("$top", "50")
        .append_pair(
            "$filter",
            &format!("lastMessagePreview/createdDateTime gt {since}"),
        );
    relative_graph_url(&url)
}

fn history_chat_query(chat_id: &str, since: &str) -> String {
    let mut url = reqwest::Url::parse(&format!(
        "https://graph.microsoft.com{}",
        chat_messages_path(chat_id)
    ))
    .expect("encoded chat path forms a valid Microsoft Graph URL");
    // Graph ignores a Teams date filter unless $orderby uses the same property.
    url.query_pairs_mut()
        .append_pair("$top", "50")
        .append_pair("$orderby", "lastModifiedDateTime desc")
        .append_pair("$filter", &format!("lastModifiedDateTime gt {since}"));
    relative_graph_url(&url)
}

fn normalize_graph_page_url(path: &str) -> Result<String, String> {
    if path.starts_with("//") {
        return Err("WorkIQ returned an unsupported paging URL.".to_string());
    }
    let absolute = if path.starts_with('/') {
        format!("https://graph.microsoft.com{path}")
    } else {
        path.to_string()
    };
    let mut url = reqwest::Url::parse(&absolute)
        .map_err(|_| "WorkIQ returned an invalid paging URL.".to_string())?;
    if url.scheme() != "https"
        || url.host_str() != Some("graph.microsoft.com")
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("WorkIQ returned an unsupported paging URL.".to_string());
    }
    if let Some(relative) = url.path().strip_prefix("/v1.0/") {
        let relative = format!("/{relative}");
        url.set_path(&relative);
    }
    Ok(relative_graph_url(&url))
}

async fn fetch_all_pages<F, Fut, P>(
    first: String,
    mut fetch: F,
    mut progress: P,
) -> Result<Value, String>
where
    F: FnMut(String) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
    P: FnMut(usize, Option<usize>, bool) -> Result<(), String>,
{
    let mut pending = VecDeque::from([normalize_graph_page_url(&first)?]);
    let mut visited = HashSet::new();
    let mut pages = Vec::new();
    let mut scanned = 0_usize;
    let mut total = None;
    while let Some(path) = pending.pop_front() {
        if !visited.insert(path.clone()) {
            return Err(
                "WorkIQ repeated a paging URL; refresh stopped to avoid a loop.".to_string(),
            );
        }
        let payload = fetch(path).await?;
        for object in collect_entity_objects(&payload) {
            if let Some(values) = object.get("value").and_then(Value::as_array) {
                scanned = scanned
                    .checked_add(values.len())
                    .ok_or_else(|| "WorkIQ returned too many history records.".to_string())?;
            }
            if let Some(reported) = object.get("@odata.count").filter(|value| !value.is_null()) {
                total = Some(
                    reported
                        .as_u64()
                        .and_then(|value| usize::try_from(value).ok())
                        .ok_or_else(|| "WorkIQ returned an invalid history total.".to_string())?,
                );
            }
            if let Some(next) = object
                .get("@odata.nextLink")
                .filter(|value| !value.is_null())
            {
                let next = next
                    .as_str()
                    .ok_or_else(|| "WorkIQ returned an invalid next-page link.".to_string())?;
                pending.push_back(normalize_graph_page_url(next)?);
            }
        }
        if total.is_some_and(|value| value < scanned) {
            total = None;
        }
        if pending.is_empty() {
            total = Some(scanned);
        }
        progress(scanned, total, pending.is_empty())?;
        pages.push(payload);
    }
    Ok(Value::Array(pages))
}

fn filter_history_samples(
    samples: Vec<MessageSample>,
    since: DateTime<Utc>,
    until: DateTime<Utc>,
) -> Result<Vec<MessageSample>, String> {
    let mut filtered = Vec::new();
    for mut sample in samples {
        let timestamp = DateTime::parse_from_rfc3339(&sample.timestamp)
            .map_err(|_| "WorkIQ returned a message with an invalid timestamp.".to_string())?
            .with_timezone(&Utc);
        if timestamp > since && timestamp <= until {
            sample.timestamp = timestamp.to_rfc3339_opts(SecondsFormat::AutoSi, true);
            filtered.push(sample);
        }
    }
    Ok(filtered)
}

fn redact_user_path(path: &Path) -> String {
    let raw = path.display().to_string();
    if let Ok(home) = env::var("USERPROFILE").or_else(|_| env::var("HOME")) {
        if !home.is_empty() && raw.starts_with(&home) {
            return format!("~{}", &raw[home.len()..]);
        }
    }
    raw
}

/// Resolve the `workiq` binary path from explicit configuration, `PATH`, or standard Windows locations.
pub fn resolve_workiq_binary(explicit: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(p) = explicit {
        if p.exists() {
            return Some(p);
        }
    }

    if let Ok(userprofile) = env::var("USERPROFILE") {
        let candidates = [
            PathBuf::from(&userprofile)
                .join(r"AppData\Local\Programs\scout\resources\app.asar.unpacked\node_modules\@microsoft\workiq\bin\win-x64\workiq.exe"),
            PathBuf::from(&userprofile)
                .join(r"AppData\Roaming\npm\node_modules\@microsoft\workiq\bin\win-x64\workiq.exe"),
            PathBuf::from(&userprofile).join(r".local\bin\workiq.exe"),
        ];
        for c in candidates {
            if c.exists() {
                return Some(c);
            }
        }
    }

    if let Ok(path_var) = env::var("PATH") {
        for dir in env::split_paths(&path_var) {
            for name in ["workiq.exe", "workiq"] {
                let full = dir.join(name);
                if full.exists() {
                    return Some(full);
                }
            }
        }
    }
    None
}

/// Normalize HTML or rich-text M365 message content into clean markdown/plain text
/// while preserving bolded bullet structures (`- **Heading:**`) for accurate slop detection.
///
/// Tags may carry attributes (Outlook adds `class="MsoNormal"` everywhere). Style, script and
/// head blocks and HTML comments are dropped, entities are decoded after the tags are removed,
/// and blank lines between bullet items are collapsed.
pub fn strip_html_preserving_structure(raw: &str) -> String {
    let truncated = truncate_html_reply_and_signature(raw);
    let mut text = String::with_capacity(truncated.len());
    let mut rest = truncated;
    let mut mention_depth: usize = 0;
    while let Some(open) = rest.find('<') {
        let segment = &rest[..open];
        if mention_depth > 0 && !segment.trim().is_empty() && !text.ends_with('@') {
            let trimmed_start = segment.trim_start();
            if !trimmed_start.starts_with('@') {
                text.push('@');
            }
        }
        text.push_str(segment);
        let tail = &rest[open..];
        if let Some(comment) = tail.strip_prefix("<!--") {
            rest = match comment.find("-->") {
                Some(end) => &comment[end + 3..],
                None => "",
            };
            continue;
        }
        let Some(close) = tail.find('>') else {
            rest = "";
            break;
        };
        let tag = &tail[1..close];
        rest = &tail[close + 1..];
        let closing = tag.starts_with('/');
        let tag_lower = tag.to_ascii_lowercase();
        let name = tag_lower
            .trim_start_matches('/')
            .split(|c: char| !c.is_ascii_alphanumeric())
            .next()
            .unwrap_or("");
        match (name, closing) {
            ("style" | "script" | "head" | "title" | "blockquote", false) => {
                let end_tag = format!("</{name}");
                rest = match find_ascii_case_insensitive(rest, &end_tag) {
                    Some(at) => match rest[at..].find('>') {
                        Some(gt) => &rest[at + gt + 1..],
                        None => "",
                    },
                    None => "",
                };
            }
            ("at", false) => {
                mention_depth = mention_depth.saturating_add(1);
            }
            ("at", true) => {
                mention_depth = mention_depth.saturating_sub(1);
            }
            ("a" | "span", false)
                if tag_lower.contains("id=\"owaam")
                    || tag_lower.contains("id='owaam")
                    || tag_lower.contains("mention") =>
            {
                mention_depth = mention_depth.saturating_add(1);
            }
            ("a" | "span", true) if mention_depth > 0 => {
                mention_depth = mention_depth.saturating_sub(1);
            }
            ("strong" | "b", _) if mention_depth == 0 => text.push_str("**"),
            ("li", false) => text.push_str("\n- "),
            ("h1" | "h2" | "h3" | "h4" | "h5" | "h6", false) => text.push_str("\n### "),
            ("p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "table", true) => {
                text.push_str("\n\n")
            }
            ("br", _) | ("li" | "ul" | "ol" | "div" | "tr", true) => text.push('\n'),
            ("td" | "th", true) => text.push(' '),
            _ => {}
        }
    }
    text.push_str(rest);
    let tidied = tidy_text_lines(&decode_html_entities(&text));
    let isolated = crate::slop_detector::isolate_authored_text(&tidied);
    if isolated.is_empty() {
        tidied
    } else {
        isolated
    }
}

fn truncate_html_reply_and_signature(raw: &str) -> &str {
    let lower = raw.to_ascii_lowercase();
    let markers = [
        "id=\"divrplyfwdmsg\"",
        "id='divrplyfwdmsg'",
        "id=\"appendonsend\"",
        "id='appendonsend'",
        "id=\"signature\"",
        "id='signature'",
        "class=\"gmail_quote\"",
        "class='gmail_quote'",
        "<hr tabindex=\"-1\"",
        "<hr tabindex='-1'",
    ];
    let mut cut = raw.len();
    for marker in markers {
        if let Some(pos) = lower.find(marker) {
            let tag_start = raw[..pos].rfind('<').unwrap_or(pos);
            if tag_start > 0 && tag_start < cut {
                cut = tag_start;
            }
        }
    }
    &raw[..cut]
}

fn find_ascii_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
    haystack.to_ascii_lowercase().find(needle)
}

/// Decode named and numeric HTML entities (`&rsquo;`, `&#8217;`, `&#x2014;`, ...).
fn decode_html_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let tail = &rest[amp..];
        let decoded = tail[1..]
            .find(';')
            .filter(|semi| (1..=10).contains(semi))
            .and_then(|semi| decode_html_entity(&tail[1..=semi]).map(|c| (c, semi + 2)));
        match decoded {
            Some((c, consumed)) => {
                out.push(c);
                rest = &tail[consumed..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn decode_html_entity(entity: &str) -> Option<char> {
    if let Some(number) = entity.strip_prefix('#') {
        let code = match number.strip_prefix(['x', 'X']) {
            Some(hex) => u32::from_str_radix(hex, 16).ok()?,
            None => number.parse().ok()?,
        };
        return char::from_u32(code);
    }
    Some(match entity {
        "nbsp" => ' ',
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "rsquo" => '\u{2019}',
        "lsquo" => '\u{2018}',
        "rdquo" => '\u{201D}',
        "ldquo" => '\u{201C}',
        "mdash" => '\u{2014}',
        "ndash" => '\u{2013}',
        "hellip" => '\u{2026}',
        "bull" => '\u{2022}',
        "middot" => '\u{00B7}',
        _ => return None,
    })
}

/// Trim line ends, collapse repeated blank lines, and drop blank lines between bullet items.
fn tidy_text_lines(text: &str) -> String {
    let lines: Vec<&str> = text.lines().map(str::trim_end).collect();
    let mut kept: Vec<&str> = Vec::with_capacity(lines.len());
    for (index, line) in lines.iter().enumerate() {
        if !line.trim().is_empty() {
            kept.push(line);
            continue;
        }
        let previous = kept.last().copied();
        let after_blank = previous.is_some_and(|last| last.trim().is_empty());
        let between_bullets = previous.is_some_and(|last| last.trim_start().starts_with("- "))
            && lines[index + 1..]
                .iter()
                .find(|next| !next.trim().is_empty())
                .is_some_and(|next| next.trim_start().starts_with("- "));
        if !after_blank && !between_bullets {
            kept.push("");
        }
    }
    kept.join("\n").trim().to_string()
}

/// Parse a WorkIQ MCP `fetch` response bundle into normalized [`MessageSample`] items.
pub fn parse_workiq_fetch_bundle(
    mcp_response: &Value,
    fallback_me_email: Option<&str>,
) -> Vec<MessageSample> {
    let inner_json = extract_inner_tool_json(mcp_response);
    let me_email = extract_me_email(&inner_json)
        .or_else(|| fallback_me_email.map(ToString::to_string))
        .unwrap_or_default()
        .to_lowercase();

    let mut samples = Vec::new();
    let entries = collect_entity_objects(&inner_json);

    for entry in entries {
        // Check if this entry or its `value` array contains mail messages
        let items: Vec<&Value> = if let Some(arr) = entry.get("value").and_then(Value::as_array) {
            arr.iter().collect()
        } else if entry.get("subject").is_some() || entry.get("bodyPreview").is_some() {
            vec![entry]
        } else {
            continue;
        };

        for item in items {
            let Some(id) = item.get("id").and_then(Value::as_str) else {
                continue;
            };
            if item.get("chatType").is_some() {
                // Skip chat metadata objects here; messages are parsed separately
                continue;
            }
            if item.get("isDraft").and_then(Value::as_bool) == Some(true) {
                continue;
            }
            let subject = item
                .get("subject")
                .and_then(Value::as_str)
                .unwrap_or("(No subject)")
                .to_string();

            let sender_email = item
                .pointer("/from/emailAddress/address")
                .and_then(Value::as_str)
                .or_else(|| {
                    item.pointer("/sender/emailAddress/address")
                        .and_then(Value::as_str)
                })
                .unwrap_or("");
            let sender_name = item
                .pointer("/from/emailAddress/name")
                .and_then(Value::as_str)
                .or(if !sender_email.is_empty() {
                    Some(sender_email)
                } else {
                    None
                })
                .unwrap_or("Unknown Sender")
                .to_string();

            let unique_body = item
                .pointer("/uniqueBody/content")
                .and_then(Value::as_str)
                .map(strip_html_preserving_structure)
                .filter(|s| !s.is_empty());
            let body = unique_body.unwrap_or_else(|| {
                let body_raw = item
                    .pointer("/body/content")
                    .and_then(Value::as_str)
                    .or_else(|| item.get("bodyPreview").and_then(Value::as_str))
                    .unwrap_or("");
                strip_html_preserving_structure(body_raw)
            });
            if body.is_empty() {
                continue;
            }

            let is_sent = item.get("sentDateTime").is_some()
                && item.get("receivedDateTime").is_none()
                || (!me_email.is_empty() && sender_email.to_lowercase() == me_email);

            let timestamp = item
                .get("receivedDateTime")
                .or_else(|| item.get("sentDateTime"))
                .and_then(Value::as_str)
                .unwrap_or("2026-10-23T14:00:00Z")
                .to_string();

            samples.push(MessageSample {
                message_id: format!("outlook-{id}"),
                app: M365App::Outlook,
                direction: if is_sent {
                    MessageDirection::Sent
                } else {
                    MessageDirection::Received
                },
                sender: sender_name,
                subject_or_topic: subject,
                body,
                timestamp,
            });
        }
    }

    samples
}

/// Parse Teams chat messages (`/me/chats/{id}/messages`) from a WorkIQ `fetch` response.
pub fn parse_teams_chat_messages(
    mcp_response: &Value,
    my_email_or_name: Option<&str>,
) -> Vec<MessageSample> {
    parse_chat_messages(mcp_response, my_email_or_name, None)
}

fn parse_chat_messages(
    mcp_response: &Value,
    me: Option<&str>,
    chat_id: Option<&str>,
) -> Vec<MessageSample> {
    let inner_json = extract_inner_tool_json(mcp_response);
    let me = me.unwrap_or("");
    let mut samples = Vec::new();

    for entry in collect_entity_objects(&inner_json) {
        let Some(arr) = entry.get("value").and_then(Value::as_array) else {
            continue;
        };
        for item in arr {
            let Some(id) = item.get("id").and_then(Value::as_str) else {
                continue;
            };
            let body_raw = item
                .pointer("/body/content")
                .and_then(Value::as_str)
                .unwrap_or("");
            let body = strip_html_preserving_structure(body_raw);
            if body.is_empty() {
                continue;
            }
            // Bots and apps post with `from.application`; the marker routes them to the
            // automated (sparkle) path instead of the people leaderboards.
            let sender_name = item
                .pointer("/from/user/displayName")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .or_else(|| {
                    item.pointer("/from/application/displayName")
                        .and_then(Value::as_str)
                        .map(|app| format!("{app} [bot]"))
                })
                .unwrap_or_else(|| "Teams Colleague".to_string());
            let is_sent = !me.is_empty()
                && [
                    item.pointer("/from/user/id").and_then(Value::as_str),
                    item.pointer("/from/user/userPrincipalName")
                        .and_then(Value::as_str),
                    Some(sender_name.as_str()),
                ]
                .into_iter()
                .flatten()
                .any(|identity| identity.eq_ignore_ascii_case(me));
            let timestamp = item
                .get("createdDateTime")
                .and_then(Value::as_str)
                .unwrap_or("2026-10-23T14:00:00Z")
                .to_string();

            samples.push(MessageSample {
                message_id: match chat_id {
                    Some(chat) => format!("teams-{chat}-{id}"),
                    None => format!("teams-{id}"),
                },
                app: M365App::Teams,
                direction: if is_sent {
                    MessageDirection::Sent
                } else {
                    MessageDirection::Received
                },
                sender: sender_name,
                subject_or_topic: "Microsoft Teams Chat".to_string(),
                body,
                timestamp,
            });
        }
    }
    samples
}

fn extract_tool_json(result: &Value) -> Result<Value, String> {
    if let Some(payload) = result
        .get("structuredContent")
        .filter(|value| !value.is_null())
    {
        if payload.is_object() || payload.is_array() {
            return Ok(payload.clone());
        }
        return Err("WorkIQ fetch returned invalid structured entity data.".to_string());
    }

    let text = result
        .pointer("/content/0/text")
        .and_then(Value::as_str)
        .ok_or_else(|| "WorkIQ fetch returned no entity data.".to_string())?;
    let payload: Value = serde_json::from_str(text)
        .map_err(|_| "WorkIQ fetch returned invalid JSON entity data.".to_string())?;
    if !payload.is_object() && !payload.is_array() {
        return Err("WorkIQ fetch returned invalid entity data.".to_string());
    }
    Ok(payload)
}

fn decode_mcp_fetch_response(response: Value) -> Result<Value, String> {
    if response.get("error").is_some_and(|error| !error.is_null()) {
        return Err("WorkIQ MCP fetch request failed.".to_string());
    }
    let result = response
        .get("result")
        .ok_or_else(|| "WorkIQ MCP fetch response is missing its result.".to_string())?;
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        return Err(
            "WorkIQ fetch tool failed. Check your WorkIQ sign-in and M365 access.".to_string(),
        );
    }
    let payload = extract_tool_json(result)?;
    for entry in collect_entity_objects(&payload) {
        if let Some(status) = entry.get("statusCode") {
            let status = status
                .as_u64()
                .ok_or_else(|| "WorkIQ fetch returned an invalid HTTP status.".to_string())?;
            if !(200..300).contains(&status) {
                return Err(format!(
                    "WorkIQ M365 fetch returned HTTP {status}. Check your account and M365 permissions."
                ));
            }
        }
    }
    Ok(payload)
}

fn extract_inner_tool_json(mcp_response: &Value) -> Value {
    if let Some(result) = mcp_response.get("result") {
        if let Ok(payload) = extract_tool_json(result) {
            return payload;
        }
    }
    mcp_response.clone()
}

fn collect_entity_objects(val: &Value) -> Vec<&Value> {
    let mut out = Vec::new();
    match val {
        Value::Array(arr) => {
            for v in arr {
                out.extend(collect_entity_objects(v));
            }
        }
        Value::Object(map) => {
            out.push(val);
            for k in ["data", "body", "result", "results", "responses"] {
                if let Some(child) = map.get(k) {
                    out.extend(collect_entity_objects(child));
                }
            }
        }
        _ => {}
    }
    out
}

fn extract_me_email(val: &Value) -> Option<String> {
    let inner = extract_inner_tool_json(val);
    for obj in collect_entity_objects(&inner) {
        if let Some(mail) = obj
            .get("mail")
            .and_then(Value::as_str)
            .or_else(|| obj.get("userPrincipalName").and_then(Value::as_str))
        {
            if mail.contains('@') {
                return Some(mail.to_string());
            }
        }
    }
    None
}

fn extract_me_user_id(val: &Value) -> Option<String> {
    let inner = extract_inner_tool_json(val);
    collect_entity_objects(&inner)
        .into_iter()
        .find(|object| object.get("mail").is_some() || object.get("userPrincipalName").is_some())
        .and_then(|object| object.get("id"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn extract_chat_ids(val: &Value) -> Vec<String> {
    let inner = extract_inner_tool_json(val);
    let mut ids = Vec::new();
    for obj in collect_entity_objects(&inner) {
        if let Some(arr) = obj.get("value").and_then(Value::as_array) {
            for item in arr {
                if item.get("chatType").is_some() {
                    if let Some(id) = item.get("id").and_then(Value::as_str) {
                        ids.push(id.to_string());
                    }
                }
            }
        }
    }
    ids
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::ready;

    #[tokio::test]
    async fn history_rejects_invalid_days_before_provider_access() {
        let client = WorkIqClient::new(
            Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")),
            None,
        );
        for days in [0, 31, u8::MAX] {
            let error = client.poll_history(days).await.unwrap_err();
            assert!(
                error.contains("between 1 and 30"),
                "Unexpected validation error: {error}"
            );
        }
    }

    #[test]
    fn history_chat_list_filters_message_activity_not_membership_updates() {
        let since = "2026-10-17T12:00:00.000Z";
        let query = reqwest::Url::parse(&format!(
            "https://graph.microsoft.com{}",
            history_chat_list_query(since)
        ))
        .unwrap();
        let params: std::collections::HashMap<_, _> = query.query_pairs().collect();
        assert_eq!(query.path(), "/me/chats");
        assert_eq!(
            params.get("$filter").map(|value| value.as_ref()),
            Some(format!("lastMessagePreview/createdDateTime gt {since}").as_str())
        );
        assert_eq!(params["$expand"], "lastMessagePreview");
        assert_eq!(
            params["$orderby"],
            "lastMessagePreview/createdDateTime desc"
        );
        assert_eq!(params["$top"], "50");
        assert!(!params.contains_key("$select"));
        assert!(!query.as_str().contains("lastUpdatedDateTime"));
    }

    #[test]
    fn history_queries_use_a_seven_day_mail_filter_and_supported_teams_filter() {
        let since = "2026-10-17T12:00:00.000Z";
        let mail = reqwest::Url::parse(&format!(
            "https://graph.microsoft.com{}",
            history_mail_query(since)
        ))
        .unwrap();
        let mail_params: std::collections::HashMap<_, _> = mail.query_pairs().collect();
        assert_eq!(mail.path(), "/me/messages");
        assert_eq!(mail_params["$top"], "50");
        assert_eq!(
            mail_params["$filter"],
            format!(
                "isDraft eq false and (receivedDateTime ge {since} or sentDateTime ge {since})"
            )
        );

        let chat = reqwest::Url::parse(&format!(
            "https://graph.microsoft.com{}",
            history_chat_query("chat/one?two", since)
        ))
        .unwrap();
        let chat_params: std::collections::HashMap<_, _> = chat.query_pairs().collect();
        assert!(chat.path().contains("chat%2Fone%3Ftwo"));
        assert_eq!(chat_params["$orderby"], "lastModifiedDateTime desc");
        assert_eq!(
            chat_params["$filter"],
            format!("lastModifiedDateTime gt {since}")
        );
    }

    #[tokio::test]
    async fn history_pagination_follows_every_opaque_next_link() {
        let first = "/me/messages?$top=50".to_string();
        let second = "/me/messages?$skiptoken=opaque%2Fpage%2Btwo".to_string();
        let third = "/me/messages?$skiptoken=opaque%2Fpage%2Bthree".to_string();
        let mut responses = VecDeque::from([
            json!({
                "results": [{
                    "data": {
                        "value": (0..50).map(|id| json!({"id": id})).collect::<Vec<_>>(),
                        "@odata.nextLink": format!("https://graph.microsoft.com/v1.0{second}")
                    }
                }]
            }),
            json!({
                "value": (50..100).map(|id| json!({"id": id})).collect::<Vec<_>>(),
                "@odata.nextLink": third
            }),
            json!({ "value": [{ "id": 100 }] }),
        ]);
        let mut requests = Vec::new();
        let payload = fetch_all_pages(
            first.clone(),
            |path| {
                requests.push(path);
                ready(Ok(responses.pop_front().unwrap()))
            },
            |_, _, _| Ok(()),
        )
        .await
        .unwrap();
        assert_eq!(requests, vec![first, second, third]);
        let count: usize = collect_entity_objects(&payload)
            .iter()
            .filter_map(|value| value.get("value").and_then(Value::as_array))
            .map(Vec::len)
            .sum();
        assert_eq!(count, 101);
    }

    #[tokio::test]
    async fn filtered_chat_pagination_follows_empty_pages_with_continuations() {
        let first = history_chat_list_query("2026-10-17T12:00:00.000Z");
        let second = format!("{first}&$skiptoken=opaque%2Fpage%2Btwo");
        let mut responses = VecDeque::from([
            json!({
                "value": [],
                "@odata.nextLink": format!("https://graph.microsoft.com/v1.0{second}")
            }),
            json!({ "value": [{ "id": "active-chat", "chatType": "group" }] }),
        ]);
        let mut requests = Vec::new();
        let payload = fetch_all_pages(
            first.clone(),
            |path| {
                requests.push(path);
                ready(Ok(responses.pop_front().unwrap()))
            },
            |_, _, _| Ok(()),
        )
        .await
        .unwrap();
        assert_eq!(requests, vec![first, second]);
        assert_eq!(extract_chat_ids(&payload), vec!["active-chat".to_string()]);
    }

    #[tokio::test]
    async fn history_pagination_includes_chats_beyond_the_old_five_chat_limit() {
        let mut page = 0;
        let payload = fetch_all_pages("/me/chats?$top=50".to_string(), |_| {
            page += 1;
            ready(Ok(if page == 1 {
                json!({
                    "value": (0..5).map(|id| json!({"id": format!("chat-{id}"), "chatType": "group"})).collect::<Vec<_>>(),
                    "@odata.nextLink": "/me/chats?$skiptoken=more"
                })
            } else {
                json!({ "value": [
                    {"id": "chat-5", "chatType": "group"},
                    {"id": "chat-6", "chatType": "group"}
                ] })
            }))
        }, |_, _, _| Ok(()))
        .await
        .unwrap();
        assert_eq!(extract_chat_ids(&payload).len(), 7);
    }

    #[tokio::test]
    async fn history_pagination_rejects_cycles_and_propagates_page_failures() {
        let cycle = fetch_all_pages(
            "/me/messages".to_string(),
            |_| {
                ready(Ok(
                    json!({ "@odata.nextLink": "/me/messages", "value": [] }),
                ))
            },
            |_, _, _| Ok(()),
        )
        .await
        .unwrap_err();
        assert!(cycle.contains("repeated"));

        let failure = fetch_all_pages(
            "/me/messages".to_string(),
            |_| ready(Err("WorkIQ page failed.".to_string())),
            |_, _, _| Ok(()),
        )
        .await
        .unwrap_err();
        assert_eq!(failure, "WorkIQ page failed.");
    }

    #[tokio::test]
    async fn history_progress_reports_each_page_and_an_exact_final_total() {
        let mut responses = VecDeque::from([
            json!({ "results": [{ "data": {
                "value": [{ "id": "a" }, { "id": "b" }],
                "@odata.count": 5,
                "@odata.nextLink": "/me/messages?$skiptoken=second"
            }}]}),
            json!({ "value": [{ "id": "c" }, { "id": "d" }],
                "@odata.nextLink": "/me/messages?$skiptoken=third" }),
            json!({ "value": [{ "id": "e" }] }),
        ]);
        let mut progress = Vec::new();
        fetch_all_pages(
            "/me/messages".to_string(),
            |_| ready(Ok(responses.pop_front().unwrap())),
            |scanned, total, finished| {
                progress.push((scanned, total, finished));
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(
            progress,
            vec![(2, Some(5), false), (4, Some(5), false), (5, Some(5), true)]
        );
    }

    #[tokio::test]
    async fn history_progress_never_invents_a_total_while_more_pages_remain() {
        for reported in [Value::Null, json!(1)] {
            let mut responses = VecDeque::from([
                json!({ "value": [{ "id": "a" }, { "id": "b" }],
                    "@odata.count": reported, "@odata.nextLink": "/me/messages?$skiptoken=second" }),
                json!({ "value": [] }),
            ]);
            let mut progress = Vec::new();
            fetch_all_pages(
                "/me/messages".to_string(),
                |_| ready(Ok(responses.pop_front().unwrap())),
                |scanned, total, finished| {
                    progress.push((scanned, total, finished));
                    Ok(())
                },
            )
            .await
            .unwrap();
            assert_eq!(progress, vec![(2, None, false), (2, Some(2), true)]);
        }
    }

    #[tokio::test]
    async fn history_progress_rejects_invalid_provider_totals_and_observer_failures() {
        let invalid = fetch_all_pages(
            "/me/messages".to_string(),
            |_| ready(Ok(json!({ "value": [], "@odata.count": "secret-value" }))),
            |_, _, _| Ok(()),
        )
        .await
        .unwrap_err();
        assert!(invalid.contains("invalid history total"));
        assert!(!invalid.contains("secret-value"));
        let observer_error = fetch_all_pages(
            "/me/messages".to_string(),
            |_| ready(Ok(json!({ "value": [] }))),
            |_, _, _| Err("Progress state is unavailable.".to_string()),
        )
        .await
        .unwrap_err();
        assert_eq!(observer_error, "Progress state is unavailable.");
    }

    #[tokio::test]
    async fn history_refresh_progress_tracks_both_providers_without_extra_reads_or_content() {
        use crate::refresh_phase::RefreshPhase;

        let until = DateTime::parse_from_rfc3339("2026-10-26T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mail = |id: &str| {
            json!({
                "id": id, "subject": "Fixture-only subject",
                "from": { "emailAddress": { "name": "Fictional sender", "address": "fictional@example.invalid" }},
                "body": { "content": "Fixture-only private body" },
                "receivedDateTime": "2026-10-25T09:00:00Z"
            })
        };
        let team = |id: &str| {
            json!({
                "id": id, "from": { "user": { "id": "other", "displayName": "Fictional sender" }},
                "body": { "content": "Fixture-only private body" },
                "createdDateTime": "2026-10-25T09:00:00Z"
            })
        };
        let mut responses = VecDeque::from([
            json!({ "id": "me", "mail": "me@example.invalid" }),
            json!({ "value": [mail("mail-1")], "@odata.count": 2, "@odata.nextLink": "/me/messages?$skiptoken=second" }),
            json!({ "value": [mail("mail-2")] }),
            json!({ "value": [
                { "id": "chat-1", "chatType": "group" },
                { "id": "chat-2", "chatType": "group" }
            ]}),
            json!({ "value": [team("team-1")], "@odata.nextLink": "/me/chats/chat-1/messages?$skiptoken=second" }),
            json!({ "value": [team("team-2")] }),
            json!({ "value": [team("team-3")] }),
        ]);
        let mut requests = Vec::new();
        let mut updates = Vec::new();
        let messages = fetch_history_with_progress(
            7,
            None,
            until,
            |paths| {
                requests.push(paths);
                ready(Ok(responses.pop_front().unwrap()))
            },
            |snapshot| {
                updates.push(snapshot);
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(messages.len(), 5);
        assert_eq!(
            requests.len(),
            7,
            "Progress must not fetch message bodies twice"
        );
        let mail_url =
            reqwest::Url::parse(&format!("https://graph.microsoft.com{}", requests[1][0])).unwrap();
        assert!(mail_url
            .query_pairs()
            .any(|(key, value)| key == "$count" && value == "true"));
        assert!(updates.iter().any(|p| p.phase == RefreshPhase::Outlook
            && p.outlook_scanned == 1
            && p.outlook_total == Some(2)));
        assert!(updates.iter().any(|p| p.phase == RefreshPhase::Teams
            && p.teams_scanned == 1
            && p.teams_total.is_none()
            && p.teams_chats_total == Some(2)));
        let last = updates.last().unwrap();
        assert_eq!(last.outlook_scanned, 2);
        assert_eq!(last.teams_scanned, 3);
        assert_eq!(last.teams_total, Some(3));
        assert_eq!(last.teams_chats_scanned, 2);
        let serialized = serde_json::to_string(&updates).unwrap();
        for forbidden in [
            "Fixture-only",
            "Fictional sender",
            "fictional@example.invalid",
            "subject",
            "body",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn history_next_links_cannot_change_the_graph_host_or_lose_the_paging_token() {
        assert_eq!(
            normalize_graph_page_url(
                "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=a%2Fb%2Bc"
            )
            .unwrap(),
            "/me/messages?$skiptoken=a%2Fb%2Bc"
        );
        assert_eq!(
            normalize_graph_page_url("https://graph.microsoft.com/v1.0/chats/19%3Aone%40thread.v2/messages?$skiptoken=a%2Fb").unwrap(),
            "/chats/19%3Aone%40thread.v2/messages?$skiptoken=a%2Fb"
        );
        for invalid in [
            "https://example.invalid/me/messages",
            "//example.invalid/me/messages",
            "http://graph.microsoft.com/v1.0/me/messages",
            "https://user:password@graph.microsoft.com/v1.0/me/messages",
        ] {
            assert!(normalize_graph_page_url(invalid).is_err());
        }
    }

    #[test]
    fn history_window_excludes_old_boundary_and_future_messages() {
        let until = DateTime::parse_from_rfc3339("2026-10-24T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let since = until - ChronoDuration::days(7);
        let timestamps = [
            "2026-10-17T11:59:59.999Z",
            "2026-10-17T12:00:00.000Z",
            "2026-10-17T12:00:00.001Z",
            "2026-10-24T14:00:00+02:00",
            "2026-10-24T12:00:00.001Z",
        ];
        let samples = timestamps
            .iter()
            .enumerate()
            .map(|(index, timestamp)| MessageSample {
                message_id: index.to_string(),
                app: M365App::Outlook,
                direction: MessageDirection::Received,
                sender: "Fictional Colleague".to_string(),
                subject_or_topic: "Synthetic range fixture".to_string(),
                body: "Ready to review.".to_string(),
                timestamp: timestamp.to_string(),
            })
            .collect();
        let filtered = filter_history_samples(samples, since, until).unwrap();
        assert_eq!(
            filtered
                .iter()
                .map(|sample| sample.message_id.as_str())
                .collect::<Vec<_>>(),
            vec!["2", "3"]
        );
        assert_eq!(filtered[1].timestamp, "2026-10-24T12:00:00Z");
    }

    #[test]
    fn history_window_reports_invalid_timestamps_without_echoing_them() {
        let now = Utc::now();
        let sample = MessageSample {
            message_id: "invalid-time".to_string(),
            app: M365App::Teams,
            direction: MessageDirection::Received,
            sender: "Fictional Colleague".to_string(),
            subject_or_topic: "Synthetic fixture".to_string(),
            body: "Ready.".to_string(),
            timestamp: "private-invalid-value".to_string(),
        };
        let error =
            filter_history_samples(vec![sample], now - ChronoDuration::days(7), now).unwrap_err();
        assert!(error.contains("invalid timestamp"));
        assert!(!error.contains("private-invalid-value"));
    }

    #[test]
    fn teams_history_uses_account_ids_and_chat_scoped_message_ids() {
        let payload = json!({ "value": [{
            "id": "same-message-id",
            "createdDateTime": "2026-10-24T10:00:00Z",
            "from": { "user": { "id": "self-id", "displayName": "Fictional User" } },
            "body": { "content": "Ready to ship." }
        }] });
        let first = parse_chat_messages(&payload, Some("self-id"), Some("chat-1"));
        let second = parse_chat_messages(&payload, Some("self-id"), Some("chat-2"));
        assert_eq!(first[0].direction, MessageDirection::Sent);
        assert_ne!(first[0].message_id, second[0].message_id);
    }

    #[test]
    fn strip_html_preserves_bold_bullets_for_slop_detection() {
        let html = "<p>I hope this email finds you well.</p><ul><li><strong>Strategic Alignment:</strong> Fostering synergy.</li><li><b>Key Takeaways:</b> Delving deeper.</li></ul>";
        let cleaned = strip_html_preserving_structure(html);
        assert!(cleaned.contains("- **Strategic Alignment:** Fostering synergy."));
        assert!(cleaned.contains("- **Key Takeaways:** Delving deeper."));
    }

    #[test]
    fn strip_html_handles_outlook_markup_and_entities() {
        let html = "<html><head><style>p.MsoNormal {margin:0cm;}</style></head><body><!-- [if gte mso 9]> x <![endif] --><p class=\"MsoNormal\">I hope you&rsquo;re doing well&nbsp;&#8212; quick update:</p><ul type=\"disc\"><li class=\"MsoListParagraph\"><b><span>Timeline:</span></b> on track</li><li class=\"MsoListParagraph\">Risks &amp; issues</li></ul><p>Let me know &lt;insert name&gt;</p></body></html>";
        let cleaned = strip_html_preserving_structure(html);
        assert!(!cleaned.contains("MsoNormal"));
        assert!(!cleaned.contains("margin"));
        assert!(cleaned.starts_with("I hope you\u{2019}re doing well \u{2014} quick update:"));
        assert!(
            cleaned.contains("quick update:\n\n- **Timeline:** on track\n- Risks & issues"),
            "{cleaned:?}"
        );
        assert!(cleaned.ends_with("Let me know <insert name>"));
        assert_eq!(
            strip_html_preserving_structure("AT&T &unknown; 5 &lt 6"),
            "AT&T &unknown; 5 &lt 6"
        );
    }

    #[test]
    fn strip_html_drops_quoted_threads_signatures_and_mention_bold_artifacts() {
        let html = "<div>Classified as Microsoft Highly Confidential</div>\
                    <div>Hi Again <a id=\"OWAAM715906\"><b>@Mariah Motsoeneng</b></a> and <at id=\"0\"><b>Olebogeng Rapudi</b></at></div>\
                    <div>Just bringing this to the top of your inbox.</div>\
                    <div id=\"Signature\"><p><b>Jean</b><br/>Principal Architect</p></div>\
                    <div id=\"appendonsend\"></div>\
                    <hr tabindex=\"-1\" />\
                    <div id=\"divRplyFwdMsg\"><p><b>From:</b> Someone</p><ul><li><b>Heading:</b> Slop wall</li></ul></div>";
        let cleaned = strip_html_preserving_structure(html);
        assert!(!cleaned.contains("Classified as Microsoft"));
        assert!(!cleaned.contains("Slop wall"));
        assert!(!cleaned.contains("Principal Architect"));
        assert!(!cleaned.contains("**"));
        assert!(cleaned.contains("@Mariah Motsoeneng"));
        assert!(cleaned.contains("@Olebogeng Rapudi"));
        assert!(cleaned.contains("Just bringing this to the top of your inbox."));
    }

    #[test]
    fn outlook_bundle_prefers_unique_body_over_full_quoted_thread() {
        let bundle = json!({
            "value": [{
                "id": "m-reply-1",
                "subject": "Re: Architecture Pack",
                "from": { "emailAddress": { "name": "Jean", "address": "jean@contoso.com" } },
                "uniqueBody": { "content": "<p>Thanks Craig, this is all that I need.</p>" },
                "body": { "content": "<p>Thanks Craig, this is all that I need.</p><ul><li><strong>Section 1:</strong> Fostering holistic synergy.</li><li><strong>Section 2:</strong> Unlocking value across paradigms.</li></ul>" },
                "sentDateTime": "2026-10-26T08:39:20Z"
            }]
        });
        let parsed = parse_workiq_fetch_bundle(&bundle, Some("jean@contoso.com"));
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].body, "Thanks Craig, this is all that I need.");
    }

    #[test]
    fn teams_bot_messages_are_marked_for_the_automated_path() {
        let payload = json!({ "value": [{
            "id": "bot-1",
            "createdDateTime": "2026-10-23T13:10:00Z",
            "from": { "application": { "displayName": "Planner" } },
            "body": { "content": "<p>Task assigned to you</p>" }
        }] });
        let messages = parse_teams_chat_messages(&payload, Some("Alex Taylor"));
        assert_eq!(messages[0].sender, "Planner [bot]");
        assert!(crate::slop_detector::is_automated_or_machine_generated(
            &messages[0]
        ));
    }

    #[test]
    fn parses_outlook_sent_and_received_messages_from_workiq_mcp_bundle() {
        let bundle = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": {
                "content": [{
                    "type": "text",
                    "text": serde_json::to_string(&json!([
                        {
                            "mail": "alex.taylor@contoso.com",
                            "displayName": "Alex Taylor"
                        },
                        {
                            "value": [
                                {
                                    "id": "m-in-1",
                                    "subject": "AI Strategy Sync",
                                    "from": { "emailAddress": { "name": "Colleague", "address": "colleague@contoso.com" } },
                                    "bodyPreview": "I hope this email finds you well.",
                                    "receivedDateTime": "2026-10-23T12:00:00Z"
                                },
                                {
                                    "id": "m-out-1",
                                    "subject": "Re: AI Strategy Sync",
                                    "from": { "emailAddress": { "name": "Alex Taylor", "address": "alex.taylor@contoso.com" } },
                                    "body": { "content": "<p>Sounds good, let's ship it at 2pm.</p>" },
                                    "sentDateTime": "2026-10-23T12:05:00Z"
                                }
                            ]
                        }
                    ])).unwrap()
                }]
            }
        });

        let parsed = parse_workiq_fetch_bundle(&bundle, None);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].direction, MessageDirection::Received);
        assert_eq!(parsed[0].app, M365App::Outlook);
        assert_eq!(parsed[1].direction, MessageDirection::Sent);
        assert_eq!(parsed[1].body, "Sounds good, let's ship it at 2pm.");
    }

    #[test]
    fn parses_teams_chat_messages_and_identifies_sender_direction() {
        let payload = json!({
            "value": [
                {
                    "id": "t-101",
                    "createdDateTime": "2026-10-23T13:10:00Z",
                    "from": { "user": { "displayName": "Alex Taylor" } },
                    "body": { "content": "Quick human check-in on the PR!" }
                },
                {
                    "id": "t-102",
                    "createdDateTime": "2026-10-23T13:12:00Z",
                    "from": { "user": { "displayName": "Jordan Example" } },
                    "body": { "content": "<ul><li><strong>Synergy:</strong> Delving into holistic alignment.</li></ul>" }
                }
            ]
        });

        let messages = parse_teams_chat_messages(&payload, Some("Alex Taylor"));
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].app, M365App::Teams);
        assert_eq!(messages[0].direction, MessageDirection::Sent);
        assert_eq!(messages[1].direction, MessageDirection::Received);
        assert!(messages[1].body.contains("- **Synergy:**"));
    }

    #[test]
    fn parses_structured_workiq_mail_identity_and_chat_results() {
        let bundle = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": {
                "structuredContent": {
                    "results": [
                        {
                            "statusCode": 200,
                            "data": { "mail": "alex@contoso.com" }
                        },
                        {
                            "statusCode": 200,
                            "data": {
                                "value": [{
                                    "id": "received-1",
                                    "subject": "Review",
                                    "from": { "emailAddress": { "address": "colleague@contoso.com" } },
                                    "bodyPreview": "Ready for review.",
                                    "receivedDateTime": "2026-10-23T12:00:00Z"
                                }]
                            }
                        },
                        {
                            "statusCode": 200,
                            "data": {
                                "value": [{
                                    "id": "sent-1",
                                    "subject": "Re: Review",
                                    "from": { "emailAddress": { "address": "alex@contoso.com" } },
                                    "bodyPreview": "Looks good.",
                                    "receivedDateTime": "2026-10-23T12:01:00Z",
                                    "sentDateTime": "2026-10-23T12:01:00Z"
                                }]
                            }
                        },
                        {
                            "statusCode": 200,
                            "data": { "value": [{ "id": "chat-1", "chatType": "oneOnOne" }] }
                        }
                    ]
                }
            }
        });

        let messages = parse_workiq_fetch_bundle(&bundle, None);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].direction, MessageDirection::Received);
        assert_eq!(messages[1].direction, MessageDirection::Sent);
        assert_eq!(
            extract_me_email(&bundle).as_deref(),
            Some("alex@contoso.com")
        );
        assert_eq!(extract_chat_ids(&bundle), vec!["chat-1"]);
    }

    #[test]
    fn parses_structured_teams_results_before_text_summary() {
        let bundle = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": {
                "content": [{ "type": "text", "text": "Messages fetched successfully." }],
                "structuredContent": {
                    "results": [{
                        "statusCode": 200,
                        "data": {
                            "value": [{
                                "id": "teams-1",
                                "createdDateTime": "2026-10-23T13:10:00Z",
                                "from": { "user": { "displayName": "Alex Taylor" } },
                                "body": { "content": "<p>Ready to ship.</p>" }
                            }]
                        }
                    }]
                }
            }
        });

        let messages = parse_teams_chat_messages(&bundle, Some("Alex Taylor"));
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].direction, MessageDirection::Sent);
        assert_eq!(messages[0].body, "Ready to ship.");
    }

    #[test]
    fn decodes_structured_and_legacy_fetch_results_including_empty_collections() {
        let payload = json!({
            "results": [{ "statusCode": 200, "data": { "value": [] } }]
        });
        for result in [
            json!({
                "structuredContent": payload,
                "content": [{ "type": "text", "text": "Fetched successfully." }]
            }),
            json!({
                "content": [{ "type": "text", "text": payload.to_string() }]
            }),
        ] {
            let response = json!({ "jsonrpc": "2.0", "id": 2, "result": result });
            assert_eq!(decode_mcp_fetch_response(response).unwrap(), payload);
        }
    }

    #[test]
    fn rejects_fetch_failures_and_invalid_data_without_exposing_response_content() {
        for response in [
            json!({ "error": { "code": -32603, "message": "private-response-content" } }),
            json!({
                "result": {
                    "isError": true,
                    "content": [{ "type": "text", "text": "private-response-content" }]
                }
            }),
            json!({
                "result": {
                    "structuredContent": {
                        "results": [{
                            "statusCode": 401,
                            "data": { "error": "private-response-content" }
                        }]
                    }
                }
            }),
            json!({
                "result": {
                    "structuredContent": {
                        "results": [{ "statusCode": "invalid", "data": {} }]
                    }
                }
            }),
            json!({}),
            json!({ "result": {} }),
            json!({ "result": { "structuredContent": "private-response-content" } }),
            json!({
                "result": {
                    "content": [{ "type": "text", "text": "private-response-content" }]
                }
            }),
            json!({
                "result": { "content": [{ "type": "text", "text": "42" }] }
            }),
        ] {
            let error = decode_mcp_fetch_response(response).unwrap_err();
            assert!(!error.contains("private-response-content"));
        }
    }
}
