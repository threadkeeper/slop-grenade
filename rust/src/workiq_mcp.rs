//! Zero-Service-Tree Microsoft 365 connector via the local WorkIQ MCP server.
//!
//! Speaks JSON-RPC 2.0 over stdio to `workiq mcp` (and supports direct CLI
//! `workiq fetch` calls) so the user can scan their Microsoft Teams chats and
//! Outlook emails using WorkIQ's built-in first-party authentication broker—
//! without registering an Entra application in Service Tree.

use std::env;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::RwLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

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
        match self.probe_mcp_tools(bin).await {
            Ok(tool_count) => WorkIqStatus {
                binary_found: true,
                binary_path: Some(bin.display().to_string()),
                version,
                mcp_ready: tool_count > 0,
                mcp_tool_count: tool_count,
                account: self.account(),
                message: format!(
                    "Connected to WorkIQ MCP ({tool_count} M365 tools registered; zero Service Tree registration required)."
                ),
            },
            Err(err) => WorkIqStatus {
                binary_found: true,
                binary_path: Some(bin.display().to_string()),
                version,
                mcp_ready: false,
                mcp_tool_count: 0,
                account: self.account(),
                message: format!(
                    "WorkIQ binary found, but MCP probe failed ({err}). Run `workiq auth login` to authenticate."
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
            "/me/mailFolders/inbox/messages?$select=id,subject,from,bodyPreview,body,receivedDateTime&$top=5".to_string(),
            "/me/mailFolders/sentitems/messages?$select=id,subject,from,bodyPreview,body,sentDateTime&$top=5".to_string(),
            "/me/chats?$select=id,topic,chatType&$top=4".to_string(),
        ];

        let payload = self
            .call_mcp_fetch(bin, &entity_urls)
            .await
            .map_err(|_| "WorkIQ MCP fetch failed".to_string())?;

        let mut samples = parse_workiq_fetch_bundle(&payload, self.account().as_deref());

        // If chats were returned, also fetch the latest messages from the top 2 active chats
        let chat_ids = extract_chat_ids(&payload);
        if !chat_ids.is_empty() {
            let chat_urls: Vec<String> = chat_ids
                .into_iter()
                .take(2)
                .map(|id| format!("/me/chats/{id}/messages?$top=5"))
                .collect();
            if let Ok(chat_payload) = self.call_mcp_fetch(bin, &chat_urls).await {
                let my_email = extract_me_email(&payload).or_else(|| self.account());
                samples.extend(parse_teams_chat_messages(
                    &chat_payload,
                    my_email.as_deref(),
                ));
            }
        }

        Ok(samples)
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
        if let Some(err) = response.get("error") {
            return Err(format!("MCP error: {err}"));
        }
        Ok(response)
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
pub fn strip_html_preserving_structure(raw: &str) -> String {
    let mut s = raw
        .replace("<strong>", "**")
        .replace("</strong>", "**")
        .replace("<b>", "**")
        .replace("</b>", "**")
        .replace("<li>", "\n- ")
        .replace("</li>", "\n")
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("</p>", "\n\n")
        .replace("</div>", "\n")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");

    // Strip any remaining HTML tags `<...>`
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.drain(..) {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
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

            let body_raw = item
                .pointer("/body/content")
                .and_then(Value::as_str)
                .or_else(|| item.get("bodyPreview").and_then(Value::as_str))
                .unwrap_or("");
            let body = strip_html_preserving_structure(body_raw);
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
    let inner_json = extract_inner_tool_json(mcp_response);
    let me_lower = my_email_or_name.unwrap_or("").to_lowercase();
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
            let sender_name = item
                .pointer("/from/user/displayName")
                .and_then(Value::as_str)
                .unwrap_or("Teams Colleague")
                .to_string();
            let is_sent = !me_lower.is_empty() && sender_name.to_lowercase().contains(&me_lower);
            let timestamp = item
                .get("createdDateTime")
                .and_then(Value::as_str)
                .unwrap_or("2026-10-23T14:00:00Z")
                .to_string();

            samples.push(MessageSample {
                message_id: format!("teams-{id}"),
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

fn extract_inner_tool_json(mcp_response: &Value) -> Value {
    if let Some(text) = mcp_response
        .pointer("/result/content/0/text")
        .and_then(Value::as_str)
    {
        if let Ok(parsed) = serde_json::from_str::<Value>(text) {
            return parsed;
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

    #[test]
    fn strip_html_preserves_bold_bullets_for_slop_detection() {
        let html = "<p>I hope this email finds you well.</p><ul><li><strong>Strategic Alignment:</strong> Fostering synergy.</li><li><b>Key Takeaways:</b> Delving deeper.</li></ul>";
        let cleaned = strip_html_preserving_structure(html);
        assert!(cleaned.contains("- **Strategic Alignment:** Fostering synergy."));
        assert!(cleaned.contains("- **Key Takeaways:** Delving deeper."));
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
                            "mail": "jeanva@microsoft.com",
                            "displayName": "Jean Van Iddekinge"
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
                                    "from": { "emailAddress": { "name": "Jean Van Iddekinge", "address": "jeanva@microsoft.com" } },
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
                    "from": { "user": { "displayName": "Jean Van Iddekinge" } },
                    "body": { "content": "Quick human check-in on the PR!" }
                },
                {
                    "id": "t-102",
                    "createdDateTime": "2026-10-23T13:12:00Z",
                    "from": { "user": { "displayName": "Alex Example" } },
                    "body": { "content": "<ul><li><strong>Synergy:</strong> Delving into holistic alignment.</li></ul>" }
                }
            ]
        });

        let messages = parse_teams_chat_messages(&payload, Some("Jean Van Iddekinge"));
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].app, M365App::Teams);
        assert_eq!(messages[0].direction, MessageDirection::Sent);
        assert_eq!(messages[1].direction, MessageDirection::Received);
        assert!(messages[1].body.contains("- **Synergy:**"));
    }
}
