//! Synthetic in-process Google protocol tests; no external credentials or mailbox.

use super::*;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use axum::extract::{Form, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

#[derive(Default)]
struct FakeGoogle {
    profile_failure: AtomicBool,
    malformed: AtomicBool,
    invalid_grant: AtomicBool,
    history_expired: AtomicBool,
    message_unauthorized: AtomicBool,
    oversized_unauthorized: AtomicBool,
    pages: AtomicBool,
    page_cycle: AtomicBool,
    unbounded_pages: AtomicBool,
    message_overflow: AtomicBool,
    oversized: AtomicBool,
    history_pages: AtomicBool,
    history_cycle: AtomicBool,
    history_regression: AtomicBool,
    block_message: AtomicBool,
    message_started: tokio::sync::Notify,
    release_message: tokio::sync::Notify,
    revoke_failure: AtomicBool,
    rate_limits: AtomicUsize,
    unavailable: AtomicUsize,
    retry_after_secs: AtomicUsize,
    expected_redirect: std::sync::Mutex<String>,
    refreshes: AtomicUsize,
    revocations: AtomicUsize,
    requests: std::sync::Mutex<Vec<String>>,
}

struct FakeServer {
    google: Arc<FakeGoogle>,
    base: String,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for FakeServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl FakeServer {
    async fn start() -> Self {
        let google = Arc::new(FakeGoogle::default());
        let router = Router::new()
            .route("/token", post(token))
            .route("/revoke", post(revoke))
            .route("/gmail/v1/users/me/profile", get(profile))
            .route("/gmail/v1/users/me/messages", get(messages))
            .route("/gmail/v1/users/me/messages/{id}", get(message))
            .route("/gmail/v1/users/me/history", get(history))
            .with_state(google.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listen");
        let base = format!("http://{}", listener.local_addr().expect("address"));
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.expect("serve");
        });
        Self { google, base, task }
    }

    fn scanner(&self) -> GmailScanner {
        self.scanner_with_redirect("http://127.0.0.1:8090/api/v1/auth/google/callback".into())
    }

    fn scanner_with_redirect(&self, redirect: String) -> GmailScanner {
        self.google
            .expected_redirect
            .lock()
            .expect("redirect")
            .clone_from(&redirect);
        let config = AppConfig {
            gmail_oauth_client_id: Some("synthetic.apps.googleusercontent.com".into()),
            ..AppConfig::default()
        };
        GmailScanner::with_http(
            &config,
            redirect,
            Arc::new(AwarenessLedger::new()),
            Arc::new(AnimationEventBus::new()),
            GoogleHttp::fake(&self.base).expect("fake transport"),
        )
        .expect("scanner")
    }
}

fn account(headers: &HeaderMap) -> &'static str {
    match headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
    {
        Some("Bearer access-two") => "two",
        Some("Bearer access-one") => "one",
        _ => "invalid",
    }
}

async fn token(
    State(google): State<Arc<FakeGoogle>>,
    Form(form): Form<HashMap<String, String>>,
) -> Response {
    assert!(!form.contains_key("client_secret"));
    let identity = if form.get("grant_type").map(String::as_str) == Some("refresh_token") {
        google.refreshes.fetch_add(1, Ordering::SeqCst);
        if google.invalid_grant.load(Ordering::SeqCst) {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error":"invalid_grant","error_description":"SECRET_UPSTREAM_ERROR",
                })),
            )
                .into_response();
        }
        assert_eq!(
            form.get("refresh_token").map(String::as_str),
            Some("refresh-one")
        );
        "one"
    } else {
        assert_eq!(
            form.get("grant_type").map(String::as_str),
            Some("authorization_code")
        );
        let verifier = form.get("code_verifier").expect("verifier");
        assert_eq!(
            URL_SAFE_NO_PAD
                .decode(verifier)
                .expect("base64 verifier")
                .len(),
            32
        );
        assert_eq!(
            form.get("redirect_uri").map(String::as_str),
            Some(google.expected_redirect.lock().expect("redirect").as_str())
        );
        match form.get("code").map(String::as_str) {
            Some("one") => "one",
            Some("two") => "two",
            _ => return StatusCode::BAD_REQUEST.into_response(),
        }
    };
    Json(json!({
        "access_token":format!("access-{identity}"),
        "refresh_token":format!("refresh-{identity}"),
        "expires_in":3600,"token_type":"Bearer",
        "scope":"https://www.googleapis.com/auth/gmail.readonly",
    }))
    .into_response()
}

async fn revoke(
    State(google): State<Arc<FakeGoogle>>,
    Form(form): Form<HashMap<String, String>>,
) -> StatusCode {
    assert!(matches!(
        form.get("token").map(String::as_str),
        Some("refresh-one" | "refresh-two")
    ));
    google.revocations.fetch_add(1, Ordering::SeqCst);
    if google.revoke_failure.load(Ordering::SeqCst) {
        StatusCode::SERVICE_UNAVAILABLE
    } else {
        StatusCode::OK
    }
}

async fn profile(State(google): State<Arc<FakeGoogle>>, headers: HeaderMap) -> Response {
    let identity = account(&headers);
    if google.profile_failure.load(Ordering::SeqCst) || identity == "invalid" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":{"message":"SECRET_PROFILE_ERROR"}})),
        )
            .into_response();
    }
    Json(json!({"emailAddress":format!("{identity}@example.invalid"),"historyId":"100"}))
        .into_response()
}

async fn messages(
    State(google): State<Arc<FakeGoogle>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    assert_ne!(account(&headers), "invalid");
    assert_eq!(
        query.get("q").map(String::as_str),
        Some("newer_than:7d -in:drafts -in:spam -in:trash")
    );
    assert_eq!(
        query.get("includeSpamTrash").map(String::as_str),
        Some("false")
    );
    assert!(
        !query.contains_key("labelIds"),
        "archived and sent messages must remain included"
    );
    google
        .requests
        .lock()
        .expect("requests")
        .push("messages".into());
    if google.unbounded_pages.load(Ordering::SeqCst) {
        let next = query
            .get("pageToken")
            .map_or(0, |token| token.parse::<usize>().expect("page token"))
            + 1;
        return Json(json!({"nextPageToken":next.to_string()})).into_response();
    }
    if google.message_overflow.load(Ordering::SeqCst) {
        let ids: Vec<_> = (0..201)
            .map(|id| json!({"id":format!("synthetic-{id}")}))
            .collect();
        return Json(json!({"messages":ids})).into_response();
    }
    if google.oversized.load(Ordering::SeqCst) {
        return "x".repeat(2 * 1024 * 1024 + 1).into_response();
    }
    if google.page_cycle.load(Ordering::SeqCst) {
        return Json(json!({"messages":[{"id":"initial"}],"nextPageToken":"cycle"}))
            .into_response();
    }
    if google.pages.load(Ordering::SeqCst) && !query.contains_key("pageToken") {
        return Json(json!({"messages":[{"id":"initial"}],"nextPageToken":"second"}))
            .into_response();
    }
    if query.contains_key("pageToken") {
        assert_eq!(query.get("pageToken").map(String::as_str), Some("second"));
        Json(json!({"messages":[{"id":"page-two"},{"id":"initial"}]})).into_response()
    } else {
        Json(json!({"messages":[{"id":"initial"}]})).into_response()
    }
}

fn fixture(id: &str, malformed: bool) -> Value {
    json!({
        "id":id, "labelIds":if id == "incremental" { vec!["SENT"] } else { vec![] },
        "internalDate":chrono::Utc::now().timestamp_millis().to_string(),
        "snippet":"RAW_SNIPPET_MARKER",
        "payload":{
            "mimeType":"multipart/alternative",
            "headers":[
                {"name":"From","value":"RAW_SENDER_MARKER <synthetic-sender@example.invalid>"},
                {"name":"Subject","value":"RAW_SUBJECT_MARKER"},
            ],
            "parts":[
                {"mimeType":"text/plain","body":{"data":URL_SAFE_NO_PAD.encode(
                    "RAW_BODY_MARKER Let's delve into this game-changing tapestry. In conclusion, leverage synergy and unlock unparalleled potential."
                )}},
                {"mimeType":"text/html","body":{"data":if malformed { "***".into() } else {
                    URL_SAFE_NO_PAD.encode("<p>HTML_FALLBACK_MARKER</p>")
                }}},
            ],
        },
    })
}

async fn message(
    State(google): State<Arc<FakeGoogle>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    assert_eq!(query.get("format").map(String::as_str), Some("full"));
    assert!(!query["fields"].contains("snippet"));
    let identity = account(&headers);
    google
        .requests
        .lock()
        .expect("requests")
        .push(format!("message:{identity}:{id}"));
    if google.block_message.swap(false, Ordering::SeqCst) {
        google.message_started.notify_one();
        google.release_message.notified().await;
    }
    for (count, status) in [
        (&google.rate_limits, StatusCode::TOO_MANY_REQUESTS),
        (&google.unavailable, StatusCode::SERVICE_UNAVAILABLE),
    ] {
        if count
            .try_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                count.checked_sub(1)
            })
            .is_ok()
        {
            return (
                status,
                [(
                    axum::http::header::RETRY_AFTER,
                    google.retry_after_secs.load(Ordering::SeqCst).to_string(),
                )],
                Json(json!({"error":{"message":"SECRET_RETRY_ERROR"}})),
            )
                .into_response();
        }
    }
    if google.message_unauthorized.load(Ordering::SeqCst) && identity == "one" {
        if google.oversized_unauthorized.load(Ordering::SeqCst) {
            return (StatusCode::UNAUTHORIZED, "x".repeat(2 * 1024 * 1024 + 1)).into_response();
        }
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":{"message":"SECRET_ACCESS_ERROR"}})),
        )
            .into_response();
    }
    Json(fixture(
        &id,
        google.malformed.load(Ordering::SeqCst) && identity == "one" && id == "page-two",
    ))
    .into_response()
}

async fn history(
    State(google): State<Arc<FakeGoogle>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    assert_ne!(account(&headers), "invalid");
    assert_eq!(
        query.get("historyTypes").map(String::as_str),
        Some("messageAdded")
    );
    google
        .requests
        .lock()
        .expect("requests")
        .push("history".into());
    if google.history_expired.swap(false, Ordering::SeqCst) {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error":{"message":"SECRET_HISTORY_ERROR"}})),
        )
            .into_response();
    }
    if google.history_cycle.load(Ordering::SeqCst) {
        return Json(json!({"historyId":"101","nextPageToken":"cycle"})).into_response();
    }
    if google.history_pages.load(Ordering::SeqCst) {
        return if !query.contains_key("pageToken") {
            Json(
                json!({"historyId":"102","nextPageToken":"history-second","history":[
                    {"messagesAdded":[{"message":{"id":"incremental","labelIds":["SENT"]}}]}
                ]}),
            )
            .into_response()
        } else {
            assert_eq!(
                query.get("pageToken").map(String::as_str),
                Some("history-second")
            );
            Json(json!({"historyId":if google.history_regression.load(Ordering::SeqCst) { "101" } else { "103" },
                "history":[{"messagesAdded":[
                    {"message":{"id":"page-two","labelIds":["INBOX"]}},
                    {"message":{"id":"incremental","labelIds":["SENT"]}}
                ]}]})).into_response()
        };
    }
    let entries = if query.get("startHistoryId").map(String::as_str) == Some("100") {
        json!([{"messagesAdded":[
            {"message":{"id":"incremental","labelIds":["SENT"]}},
            {"message":{"id":"incremental","labelIds":["SENT"]}},
            {"message":{"id":"draft","labelIds":["DRAFT"]}},
        ]}])
    } else {
        json!([])
    };
    Json(json!({"historyId":"101","history":entries})).into_response()
}

async fn authorize(
    scanner: &GmailScanner,
    code: &str,
    reconnect: Option<&str>,
) -> Result<String, GmailError> {
    let value = scanner.authorize(reconnect).await?;
    let url = reqwest::Url::parse(value["authorizationUrl"].as_str().expect("url")).expect("parse");
    let state = url
        .query_pairs()
        .find(|(key, _)| key == "state")
        .expect("state")
        .1
        .into_owned();
    scanner
        .complete_authorization(Some(&state), Some(code), None)
        .await?;
    Ok(state)
}

#[tokio::test]
async fn full_callback_requires_profile_and_rejects_replay_without_exposing_credentials() {
    let fake = FakeServer::start().await;
    let scanner = fake.scanner();
    let mut changes = scanner.subscribe();
    let state = authorize(&scanner, "one", None).await.expect("authorize");
    assert!(changes.try_recv().is_ok());
    let status = scanner.status().await;
    assert_eq!(status["accounts"][0]["connected"], true);
    assert_eq!(status["authorizationPending"], false);
    assert_eq!(status["accounts"][0]["id"].as_str().expect("id").len(), 64);
    assert!(matches!(
        scanner
            .complete_authorization(Some(&state), Some("one"), None)
            .await,
        Err(GmailError::InvalidState)
    ));
    let serialized = status.to_string();
    for secret in ["access-one", "refresh-one", "code_verifier", "historyId"] {
        assert!(!serialized.contains(secret));
    }
    let disconnected = fake.scanner();
    fake.google.profile_failure.store(true, Ordering::SeqCst);
    assert!(authorize(&disconnected, "one", None).await.is_err());
    assert_eq!(
        disconnected.status().await["accounts"]
            .as_array()
            .expect("accounts")
            .len(),
        0
    );
    assert_eq!(fake.google.revocations.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn quiet_initial_incremental_and_expired_history_recovery_are_deduplicated_and_private() {
    let fake = FakeServer::start().await;
    let scanner = fake.scanner();
    authorize(&scanner, "one", None).await.expect("authorize");
    let initial = scanner.scan_once().await.expect("initial");
    assert_eq!(initial["newMessagesAnalyzed"], 1);
    assert_eq!(initial["animationsTriggered"], 0);
    assert!(scanner.bus.recent_events().is_empty());
    let incremental = scanner.scan_once().await.expect("incremental");
    assert_eq!(incremental["newMessagesAnalyzed"], 1);
    assert_eq!(incremental["animationsTriggered"], 1);
    assert_eq!(scanner.bus.recent_events().len(), 1);
    assert_eq!(
        scanner.scan_once().await.expect("repeat")["newMessagesAnalyzed"],
        0
    );
    fake.google.history_expired.store(true, Ordering::SeqCst);
    fake.google.pages.store(true, Ordering::SeqCst);
    let recovery = scanner.scan_once().await.expect("recovery");
    assert_eq!(recovery["newMessagesAnalyzed"], 1);
    assert_eq!(recovery["animationsTriggered"], 0);
    assert_eq!(scanner.bus.recent_events().len(), 1);
    let reports = scanner.ledger.scorecard().recent_reports;
    assert_eq!(reports.len(), 3);
    assert!(reports
        .iter()
        .all(|report| report.app == crate::slop_detector::M365App::Gmail));
    let original: crate::gmail_mime::GmailMessage =
        serde_json::from_value(fixture("initial", false)).expect("fixture");
    let original = original
        .sample("one@example.invalid", "synthetic".into())
        .expect("sample")
        .expect("body");
    let expected_score = SlopDetector::new().analyze(&original).slop_score;
    assert!(reports
        .iter()
        .all(|report| report.slop_score == expected_score));
    let public = format!(
        "{}{}{}{}",
        scanner.status().await,
        initial,
        serde_json::to_string(&reports).expect("reports"),
        serde_json::to_string(&scanner.bus.recent_events()).expect("events")
    );
    for private in [
        "RAW_BODY_MARKER",
        "RAW_SUBJECT_MARKER",
        "RAW_SENDER_MARKER",
        "RAW_SNIPPET_MARKER",
        "HTML_FALLBACK_MARKER",
        "access-one",
        "refresh-one",
        "synthetic-sender@example.invalid",
    ] {
        assert!(
            !public.contains(private),
            "private fixture must not cross the domain boundary"
        );
    }
}

#[tokio::test]
async fn malformed_partial_batch_never_commits_checkpoint_or_ledger_and_other_accounts_continue() {
    let fake = FakeServer::start().await;
    let scanner = fake.scanner();
    authorize(&scanner, "one", None).await.expect("one");
    authorize(&scanner, "two", None).await.expect("two");
    fake.google.malformed.store(true, Ordering::SeqCst);
    fake.google.pages.store(true, Ordering::SeqCst);
    let result = scanner.scan_once().await.expect("isolated scan");
    assert_eq!(result["failedAccounts"], 1);
    assert_eq!(result["successfulAccounts"], 1);
    assert_eq!(result["newMessagesAnalyzed"], 2);
    let one = scanner
        .accounts
        .read()
        .await
        .get(&GmailAccount::identity("one@example.invalid"))
        .expect("one")
        .clone();
    assert!(one.session.lock().await.history_id.is_none());
    assert!(one.session.lock().await.seen.is_empty());
    assert_eq!(scanner.ledger.scorecard().recent_reports.len(), 2);
    fake.google.malformed.store(false, Ordering::SeqCst);
    let retry = scanner.scan_once().await.expect("retry");
    assert_eq!(retry["failedAccounts"], 0);
    // The failed account retries both original messages; the other processes history.
    assert_eq!(retry["newMessagesAnalyzed"], 3);
    assert_eq!(one.session.lock().await.history_id.as_deref(), Some("100"));
    assert!(!scanner.status().await.to_string().contains("SECRET"));
}

#[tokio::test]
async fn access_refresh_is_serialized_and_invalid_grant_erases_credentials() {
    let fake = FakeServer::start().await;
    let scanner = fake.scanner();
    authorize(&scanner, "one", None).await.expect("one");
    let account = scanner
        .accounts
        .read()
        .await
        .values()
        .next()
        .expect("account")
        .clone();
    account
        .session
        .lock()
        .await
        .tokens
        .as_mut()
        .expect("tokens")
        .expires = std::time::Instant::now();
    let (a, b) = tokio::join!(
        scanner.scan_account(&account),
        scanner.scan_account(&account)
    );
    assert!(a.is_ok() && b.is_ok());
    assert_eq!(fake.google.refreshes.load(Ordering::SeqCst), 1);
    account
        .session
        .lock()
        .await
        .tokens
        .as_mut()
        .expect("tokens")
        .expires = std::time::Instant::now();
    fake.google.invalid_grant.store(true, Ordering::SeqCst);
    let failed = scanner.scan_once().await.expect("safe failure result");
    assert_eq!(failed["failedAccounts"], 1);
    assert!(account.session.lock().await.tokens.is_none());
    assert_eq!(
        scanner.status().await["accounts"][0]["reconnectRequired"],
        true
    );
    assert!(!failed.to_string().contains("SECRET_UPSTREAM_ERROR"));
    assert_eq!(
        scanner.scan_once().await.expect("still failed")["failedAccounts"],
        1
    );
}

#[tokio::test]
async fn account_scoped_dedup_reconnect_identity_and_disconnect_revoke() {
    let fake = FakeServer::start().await;
    let scanner = fake.scanner();
    authorize(&scanner, "one", None).await.expect("one");
    authorize(&scanner, "two", None).await.expect("two");
    assert_eq!(
        scanner.scan_once().await.expect("scan")["newMessagesAnalyzed"],
        2
    );
    let reports = scanner.ledger.scorecard().recent_reports;
    assert_ne!(reports[0].message_id, reports[1].message_id);
    let id = GmailAccount::identity("one@example.invalid");
    assert_eq!(
        authorize(&scanner, "two", Some(&id)).await,
        Err(GmailError::WrongAccount)
    );
    authorize(&scanner, "one", Some(&id))
        .await
        .expect("reconnect");
    assert_eq!(
        scanner.scan_once().await.expect("history")["newMessagesAnalyzed"],
        2
    );
    let account = scanner
        .accounts
        .read()
        .await
        .get(&id)
        .expect("account")
        .clone();
    scanner.disconnect(&id).await.expect("disconnect");
    assert!(!account.is_active());
    let session = account.session.lock().await;
    assert!(session.tokens.is_none() && session.seen.is_empty() && session.history_id.is_none());
    assert_eq!(fake.google.revocations.load(Ordering::SeqCst), 2);
    assert_eq!(
        scanner.status().await["accounts"]
            .as_array()
            .expect("accounts")
            .len(),
        1
    );
    assert_eq!(scanner.ledger.scorecard().recent_reports.len(), 4);
    let restarted = fake.scanner();
    assert!(restarted.status().await["accounts"]
        .as_array()
        .expect("accounts")
        .is_empty());
}

#[tokio::test]
async fn response_bounds_and_pagination_cycles_leave_checkpoints_untouched() {
    let fake = FakeServer::start().await;
    let scanner = fake.scanner();
    authorize(&scanner, "one", None).await.expect("one");
    for oversized in [false, true] {
        fake.google.page_cycle.store(!oversized, Ordering::SeqCst);
        fake.google.oversized.store(oversized, Ordering::SeqCst);
        assert_eq!(
            scanner.scan_once().await.expect("safe result")["failedAccounts"],
            1
        );
        assert!(scanner.ledger.scorecard().recent_reports.is_empty());
        let account = scanner
            .accounts
            .read()
            .await
            .values()
            .next()
            .expect("account")
            .clone();
        assert!(account.session.lock().await.history_id.is_none());
    }
}

#[tokio::test]
async fn page_and_message_caps_fail_closed_without_silently_truncating_the_mailbox() {
    let fake = FakeServer::start().await;
    let scanner = fake.scanner();
    authorize(&scanner, "one", None).await.expect("authorize");
    let account = scanner
        .accounts
        .read()
        .await
        .values()
        .next()
        .expect("account")
        .clone();
    fake.google.unbounded_pages.store(true, Ordering::SeqCst);
    let pages = scanner.scan_once().await.expect("safe page bound");
    assert_eq!(pages["failedAccounts"], 1);
    assert_eq!(
        fake.google
            .requests
            .lock()
            .expect("requests")
            .iter()
            .filter(|request| request.as_str() == "messages")
            .count(),
        10
    );
    fake.google.unbounded_pages.store(false, Ordering::SeqCst);
    fake.google.message_overflow.store(true, Ordering::SeqCst);
    assert_eq!(
        scanner.scan_once().await.expect("safe message bound")["failedAccounts"],
        1
    );
    let session = account.session.lock().await;
    assert!(session.history_id.is_none() && session.seen.is_empty());
    assert!(scanner.ledger.scorecard().recent_reports.is_empty());
    assert!(scanner.bus.recent_events().is_empty());
}

#[tokio::test]
async fn unauthorized_api_response_erases_credentials_and_unconfigured_auth_is_explicit() {
    let fake = FakeServer::start().await;
    let scanner = fake.scanner();
    authorize(&scanner, "one", None).await.expect("one");
    fake.google
        .message_unauthorized
        .store(true, Ordering::SeqCst);
    fake.google
        .oversized_unauthorized
        .store(true, Ordering::SeqCst);
    assert_eq!(
        scanner.scan_once().await.expect("safe result")["failedAccounts"],
        1
    );
    assert_eq!(
        scanner.status().await["accounts"][0]["reconnectRequired"],
        true
    );
    let account = scanner
        .accounts
        .read()
        .await
        .values()
        .next()
        .expect("account")
        .clone();
    assert!(account.session.lock().await.tokens.is_none());
    assert!(account.session.lock().await.history_id.is_none());
    assert!(scanner.ledger.scorecard().recent_reports.is_empty());
    let config = AppConfig {
        gmail_oauth_client_id: None,
        ..AppConfig::default()
    };
    let unconfigured = GmailScanner::new(
        &config,
        "http://127.0.0.1:8090/api/v1/auth/google/callback".into(),
        Arc::new(AwarenessLedger::new()),
        Arc::new(AnimationEventBus::new()),
    )
    .expect("scanner");
    assert_eq!(
        unconfigured.authorize(None).await,
        Err(GmailError::NotConfigured)
    );
    assert_eq!(unconfigured.status().await["configured"], false);
    let config = AppConfig {
        gmail_enabled: false,
        ..config
    };
    let disabled = GmailScanner::new(
        &config,
        "http://127.0.0.1:8090/api/v1/auth/google/callback".into(),
        Arc::new(AwarenessLedger::new()),
        Arc::new(AnimationEventBus::new()),
    )
    .expect("scanner");
    assert_eq!(disabled.authorize(None).await, Err(GmailError::Disabled));
}

#[tokio::test]
async fn rejected_ingestion_is_atomic_and_retries_before_checkpoint_dedup_or_effects() {
    let fake = FakeServer::start().await;
    let scanner = fake.scanner();
    authorize(&scanner, "one", None).await.expect("authorize");
    let account = scanner
        .accounts
        .read()
        .await
        .values()
        .next()
        .expect("account")
        .clone();
    fake.google.pages.store(true, Ordering::SeqCst);
    scanner.reject_next_batch.store(true, Ordering::SeqCst);
    let failed = scanner.scan_once().await.expect("safe scan result");
    assert_eq!(failed["failedAccounts"], 1);
    assert_eq!(failed["newMessagesAnalyzed"], 0);
    assert!(scanner.ledger.scorecard().recent_reports.is_empty());
    assert!(scanner.bus.recent_events().is_empty());
    {
        let session = account.session.lock().await;
        assert!(session.history_id.is_none() && session.seen.is_empty());
    }
    assert!(account.status()["lastSuccessfulScan"].is_null());
    assert_eq!(
        scanner.scan_once().await.expect("retry")["newMessagesAnalyzed"],
        2
    );
    assert_eq!(
        account.session.lock().await.history_id.as_deref(),
        Some("100")
    );
    scanner.reject_next_batch.store(true, Ordering::SeqCst);
    assert_eq!(
        scanner.scan_once().await.expect("incremental rejection")["failedAccounts"],
        1
    );
    assert_eq!(
        account.session.lock().await.history_id.as_deref(),
        Some("100")
    );
    assert_eq!(scanner.ledger.scorecard().recent_reports.len(), 2);
    assert!(scanner.bus.recent_events().is_empty());
    assert_eq!(
        scanner.scan_once().await.expect("incremental retry")["newMessagesAnalyzed"],
        1
    );
    assert_eq!(
        account.session.lock().await.history_id.as_deref(),
        Some("101")
    );
    assert_eq!(scanner.ledger.scorecard().recent_reports.len(), 3);
    assert_eq!(scanner.bus.recent_events().len(), 1);
}

#[tokio::test]
async fn history_pagination_is_deduplicated_and_never_accepts_cycles_or_regression() {
    let fake = FakeServer::start().await;
    let scanner = fake.scanner();
    authorize(&scanner, "one", None).await.expect("authorize");
    scanner.scan_once().await.expect("initial");
    let account = scanner
        .accounts
        .read()
        .await
        .values()
        .next()
        .expect("account")
        .clone();
    fake.google.history_cycle.store(true, Ordering::SeqCst);
    assert_eq!(
        scanner.scan_once().await.expect("cycle")["failedAccounts"],
        1
    );
    fake.google.history_cycle.store(false, Ordering::SeqCst);
    fake.google.history_pages.store(true, Ordering::SeqCst);
    fake.google.history_regression.store(true, Ordering::SeqCst);
    assert_eq!(
        scanner.scan_once().await.expect("regression")["failedAccounts"],
        1
    );
    assert_eq!(
        account.session.lock().await.history_id.as_deref(),
        Some("100")
    );
    assert_eq!(scanner.ledger.scorecard().recent_reports.len(), 1);
    assert!(scanner.bus.recent_events().is_empty());
    fake.google
        .history_regression
        .store(false, Ordering::SeqCst);
    let result = scanner.scan_once().await.expect("history pages");
    assert_eq!(result["newMessagesAnalyzed"], 2);
    assert_eq!(result["animationsTriggered"], 2);
    assert_eq!(
        account.session.lock().await.history_id.as_deref(),
        Some("103")
    );
}

#[tokio::test]
async fn rate_limits_and_transient_errors_retry_boundedly_and_respect_retry_after() {
    let fake = FakeServer::start().await;
    let scanner = fake.scanner();
    authorize(&scanner, "one", None).await.expect("authorize");
    fake.google.rate_limits.store(1, Ordering::SeqCst);
    fake.google.unavailable.store(1, Ordering::SeqCst);
    assert_eq!(
        scanner.scan_once().await.expect("retry success")["newMessagesAnalyzed"],
        1
    );
    let count = || {
        fake.google
            .requests
            .lock()
            .expect("requests")
            .iter()
            .filter(|request| request.starts_with("message:"))
            .count()
    };
    assert_eq!(count(), 3);
    fake.google.rate_limits.store(9, Ordering::SeqCst);
    let failed = scanner.scan_once().await.expect("retry exhausted");
    assert_eq!(failed["failedAccounts"], 1);
    assert_eq!(count(), 6);
    assert!(!failed.to_string().contains("SECRET_RETRY_ERROR"));
    fake.google.rate_limits.store(1, Ordering::SeqCst);
    fake.google.retry_after_secs.store(90, Ordering::SeqCst);
    assert_eq!(
        scanner.scan_once().await.expect("long retry-after")["failedAccounts"],
        1
    );
    assert_eq!(
        count(),
        7,
        "must fail rather than retry before Google's requested delay"
    );
    fake.google.rate_limits.store(0, Ordering::SeqCst);
    assert_eq!(
        scanner
            .scan_once()
            .await
            .expect("cooldown persists across polls")["failedAccounts"],
        1
    );
    assert_eq!(count(), 7, "a later poll must not bypass Retry-After");
    authorize(
        &scanner,
        "one",
        Some(&GmailAccount::identity("one@example.invalid")),
    )
    .await
    .expect("reconnect");
    assert_eq!(
        scanner
            .scan_once()
            .await
            .expect("reconnect retains cooldown")["failedAccounts"],
        1
    );
    assert_eq!(
        count(),
        7,
        "new credentials must not bypass the account's cooldown"
    );
    authorize(&scanner, "two", None)
        .await
        .expect("other account");
    let isolated = scanner.scan_once().await.expect("isolated cooldown");
    assert_eq!(isolated["successfulAccounts"], 1);
    assert_eq!(isolated["failedAccounts"], 1);
    assert_eq!(
        count(),
        8,
        "one account's Retry-After must not block another account"
    );
    let account = scanner
        .accounts
        .read()
        .await
        .values()
        .next()
        .expect("account")
        .clone();
    let one = scanner
        .accounts
        .read()
        .await
        .get(&GmailAccount::identity("one@example.invalid"))
        .expect("one")
        .clone();
    assert_eq!(one.session.lock().await.history_id.as_deref(), Some("100"));
    assert!(account.session.lock().await.tokens.is_some());
    assert_eq!(scanner.ledger.scorecard().recent_reports.len(), 2);
}

#[tokio::test]
async fn disconnect_during_staging_cannot_ingest_or_publish_after_account_removal() {
    let fake = FakeServer::start().await;
    let scanner = Arc::new(fake.scanner());
    authorize(&scanner, "one", None).await.expect("authorize");
    scanner.scan_once().await.expect("initial");
    let account = scanner
        .accounts
        .read()
        .await
        .values()
        .next()
        .expect("account")
        .clone();
    fake.google.block_message.store(true, Ordering::SeqCst);
    let scanning = scanner.clone();
    let scan = tokio::spawn(async move { scanning.scan_once().await });
    tokio::time::timeout(
        Duration::from_secs(2),
        fake.google.message_started.notified(),
    )
    .await
    .expect("staging reached");
    assert_eq!(scanner.scan_once().await, Err(GmailError::Busy));
    let disconnecting = scanner.clone();
    let id = account.id().to_owned();
    fake.google.revoke_failure.store(true, Ordering::SeqCst);
    let disconnect = tokio::spawn(async move { disconnecting.disconnect(&id).await });
    tokio::time::timeout(Duration::from_secs(2), async {
        while account.is_active() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("account deactivated before waiting for scan");
    tokio::time::timeout(Duration::from_secs(2), disconnect)
        .await
        .expect("disconnect must cancel in-flight staging without waiting for Google")
        .expect("disconnect task")
        .expect("local removal despite revocation failure");
    assert_eq!(
        scan.await.expect("scan task").expect("scan result")["failedAccounts"],
        1
    );
    fake.google.release_message.notify_one();
    assert_eq!(scanner.ledger.scorecard().recent_reports.len(), 1);
    assert!(scanner.bus.recent_events().is_empty());
    let session = account.session.lock().await;
    assert!(session.tokens.is_none() && session.history_id.is_none() && session.seen.is_empty());
    assert!(scanner.status().await["accounts"]
        .as_array()
        .expect("accounts")
        .is_empty());
    assert_eq!(fake.google.revocations.load(Ordering::SeqCst), 1);
    assert_eq!(
        scanner.scan_once().await.expect("disconnected scan")["successfulAccounts"],
        0
    );
}

struct FakeDashboard {
    base: String,
    task: tokio::task::JoinHandle<()>,
    gmail: Arc<GmailScanner>,
}

impl Drop for FakeDashboard {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl FakeDashboard {
    async fn start(fake: &FakeServer) -> Self {
        use crate::llm_luna::LunaClient;
        use crate::scanner_daemon::ScannerDaemon;
        use crate::server::{build_router, AppState};
        use crate::workiq_mcp::WorkIqClient;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listen");
        let base = format!("http://{}", listener.local_addr().expect("address"));
        let gmail =
            Arc::new(fake.scanner_with_redirect(format!("{base}/api/v1/auth/google/callback")));
        let workiq = Arc::new(WorkIqClient::new(
            Some(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")),
            None,
        ));
        let luna = Arc::new(LunaClient::new(
            "https://example.invalid/never-requested".into(),
            "synthetic-disabled".into(),
            false,
        ));
        let ledger = gmail.ledger.clone();
        let bus = gmail.bus.clone();
        let daemon = Arc::new(ScannerDaemon::new(
            workiq.clone(),
            luna.clone(),
            ledger.clone(),
            bus.clone(),
        ));
        let app = build_router(AppState {
            daemon,
            workiq,
            luna,
            ledger,
            bus,
            gmail: gmail.clone(),
            web_asset_dir: std::path::PathBuf::from("nonexistent-synthetic-web"),
            sim_counter: Arc::new(std::sync::atomic::AtomicU64::new(1)),
        });
        let task = tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .await
            .expect("dashboard");
        });
        Self { base, task, gmail }
    }
}

#[tokio::test]
async fn provider_logout_waits_for_other_provider_scan_and_wipes_its_checkpoint() {
    let fake = FakeServer::start().await;
    let app = FakeDashboard::start(&fake).await;
    authorize(&app.gmail, "one", None).await.unwrap();
    app.gmail.scan_once().await.unwrap();
    let account = app
        .gmail
        .accounts
        .read()
        .await
        .values()
        .next()
        .unwrap()
        .clone();
    fake.google.block_message.store(true, Ordering::SeqCst);
    let scanning = app.gmail.clone();
    let scan = tokio::spawn(async move { scanning.scan_once().await });
    tokio::time::timeout(
        Duration::from_secs(2),
        fake.google.message_started.notified(),
    )
    .await
    .expect("Gmail scan staged before logout");
    let base = app.base.clone();
    let logout = tokio::spawn(async move {
        reqwest::Client::new()
            .post(format!("{base}/api/v1/auth/workiq-logout"))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()
    });
    tokio::time::timeout(Duration::from_secs(2), async {
        while app.gmail.ledger.communication_gate().try_read().is_ok() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("wipe queued behind in-flight Gmail scan");
    assert!(!logout.is_finished());
    fake.google.release_message.notify_one();
    assert_eq!(scan.await.unwrap().unwrap()["successfulAccounts"], 1);
    let wipe = logout.await.unwrap();
    assert_eq!(wipe["dataWiped"], true);
    assert_eq!(wipe["resetGeneration"], 1);
    assert_eq!(wipe["clearedReports"], 2);
    assert_eq!(wipe["clearedDeduplicationKeys"], 2);
    assert_eq!(app.gmail.ledger.scorecard().reset_generation, 1);
    assert!(app.gmail.ledger.scorecard().recent_reports.is_empty());
    assert!(app.gmail.bus.recent_events().is_empty());
    assert_eq!(app.gmail.bus.events_after(0).len(), 1);
    {
        let session = account.session.lock().await;
        assert!(session.history_id.is_none());
        assert!(session.seen.is_empty());
        assert!(
            session.tokens.is_some(),
            "other provider remains authorized"
        );
    }
    assert!(account.is_active());
    assert_eq!(
        app.gmail.scan_once().await.unwrap()["newMessagesAnalyzed"],
        1
    );
    assert_eq!(app.gmail.ledger.scorecard().recent_reports.len(), 1);
    assert_eq!(app.gmail.ledger.scorecard().reset_generation, 1);
}

fn authorization_state(value: &Value) -> String {
    reqwest::Url::parse(
        value["authorizationUrl"]
            .as_str()
            .expect("authorization URL"),
    )
    .expect("parse URL")
    .query_pairs()
    .find(|(key, _)| key == "state")
    .expect("state")
    .1
    .into_owned()
}

#[tokio::test]
async fn gmail_http_authorize_callback_scan_quiet_recovery_reconnect_and_disconnect() {
    let fake = FakeServer::start().await;
    let app = FakeDashboard::start(&fake).await;
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .expect("client");
    let authorization = client
        .post(format!("{}/api/v1/gmail/authorize", app.base))
        .send()
        .await
        .expect("authorize");
    assert_eq!(authorization.status(), StatusCode::OK);
    assert_eq!(authorization.headers()["cache-control"], "no-store");
    let authorization: Value = authorization.json().await.expect("authorization JSON");
    assert_eq!(
        client
            .post(format!("{}/api/v1/gmail/authorize", app.base))
            .send()
            .await
            .expect("duplicate")
            .status(),
        StatusCode::CONFLICT
    );
    let state = authorization_state(&authorization);
    assert_eq!(
        client
            .get(format!("{}/api/v1/auth/google/callback", app.base))
            .query(&[("code", "one")])
            .send()
            .await
            .expect("missing state")
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        client
            .get(format!("{}/api/v1/auth/google/callback", app.base))
            .query(&[("state", "mismatched"), ("code", "one")])
            .send()
            .await
            .expect("mismatch")
            .status(),
        StatusCode::BAD_REQUEST
    );
    let callback = client
        .get(format!("{}/api/v1/auth/google/callback", app.base))
        .query(&[("state", state.as_str()), ("code", "one")])
        .send()
        .await
        .expect("callback");
    assert_eq!(callback.status(), StatusCode::OK);
    assert!(!callback
        .text()
        .await
        .expect("callback text")
        .contains(&state));
    assert_eq!(
        client
            .get(format!("{}/api/v1/auth/google/callback", app.base))
            .query(&[("state", state.as_str()), ("code", "one")])
            .send()
            .await
            .expect("replay")
            .status(),
        StatusCode::BAD_REQUEST
    );
    let accounts: Value = client
        .get(format!("{}/api/v1/gmail/accounts", app.base))
        .send()
        .await
        .expect("accounts")
        .json()
        .await
        .expect("accounts JSON");
    assert_eq!(accounts["accounts"][0]["connected"], true);
    let id = accounts["accounts"][0]["id"]
        .as_str()
        .expect("hashed account ID");
    let initial: Value = client
        .post(format!("{}/api/v1/gmail/scan", app.base))
        .send()
        .await
        .expect("initial")
        .json()
        .await
        .expect("initial JSON");
    assert_eq!(initial["newMessagesAnalyzed"], 1);
    assert_eq!(initial["animationsTriggered"], 0);
    let incremental: Value = client
        .post(format!("{}/api/v1/gmail/scan", app.base))
        .send()
        .await
        .expect("incremental")
        .json()
        .await
        .expect("incremental JSON");
    assert_eq!(incremental["newMessagesAnalyzed"], 1);
    assert_eq!(incremental["animationsTriggered"], 1);
    fake.google.history_expired.store(true, Ordering::SeqCst);
    fake.google.pages.store(true, Ordering::SeqCst);
    let recovery: Value = client
        .post(format!("{}/api/v1/gmail/scan", app.base))
        .send()
        .await
        .expect("recovery")
        .json()
        .await
        .expect("recovery JSON");
    assert_eq!(recovery["newMessagesAnalyzed"], 1);
    assert_eq!(recovery["animationsTriggered"], 0);
    let ledger: Value = client
        .get(format!("{}/api/v1/ledger", app.base))
        .send()
        .await
        .expect("ledger")
        .json()
        .await
        .expect("ledger JSON");
    assert_eq!(
        ledger["recentReports"].as_array().expect("reports").len(),
        3
    );
    assert!(ledger["recentReports"]
        .as_array()
        .expect("reports")
        .iter()
        .all(|report| report["app"] == "gmail"));
    let events: Value = client
        .get(format!("{}/api/v1/events/recent", app.base))
        .send()
        .await
        .expect("events")
        .json()
        .await
        .expect("events JSON");
    let public = format!("{accounts}{initial}{incremental}{recovery}{ledger}{events}");
    for private in [
        "RAW_BODY_MARKER",
        "RAW_SUBJECT_MARKER",
        "RAW_SENDER_MARKER",
        "RAW_SNIPPET_MARKER",
        "HTML_FALLBACK_MARKER",
        "access-one",
        "refresh-one",
        "synthetic-sender@example.invalid",
        "code_verifier",
    ] {
        assert!(
            !public.contains(private),
            "HTTP domain boundary must not expose fixture content or credentials"
        );
    }
    let reconnect: Value = client
        .post(format!("{}/api/v1/gmail/accounts/{id}/reconnect", app.base))
        .send()
        .await
        .expect("reconnect")
        .json()
        .await
        .expect("reconnect JSON");
    let reconnect_state = authorization_state(&reconnect);
    assert_eq!(
        client
            .get(format!("{}/api/v1/auth/google/callback", app.base))
            .query(&[("state", reconnect_state.as_str()), ("code", "one")])
            .send()
            .await
            .expect("reconnect callback")
            .status(),
        StatusCode::OK
    );
    let disconnect: Value = client
        .delete(format!("{}/api/v1/gmail/accounts/{id}", app.base))
        .send()
        .await
        .expect("disconnect")
        .json()
        .await
        .expect("disconnect JSON");
    assert_eq!(disconnect["ok"], true);
    assert_eq!(disconnect["dataWiped"], true);
    assert_eq!(disconnect["resetGeneration"], 1);
    assert_eq!(disconnect["clearedReports"], 3);
    assert_eq!(disconnect["clearedEvents"], 1);
    let ledger: Value = client
        .get(format!("{}/api/v1/ledger", app.base))
        .send()
        .await
        .expect("ledger")
        .json()
        .await
        .expect("ledger JSON");
    assert_eq!(ledger["recentReports"], json!([]));
    let accounts: Value = client
        .get(format!("{}/api/v1/gmail/accounts", app.base))
        .send()
        .await
        .expect("accounts")
        .json()
        .await
        .expect("accounts JSON");
    assert_eq!(accounts["accounts"], json!([]));
    assert_eq!(fake.google.revocations.load(Ordering::SeqCst), 1);
}
