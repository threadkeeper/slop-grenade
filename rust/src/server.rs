//! Axum HTTP + Server-Sent Events (SSE) API server for Slop Grenade.
//!
//! Exposes endpoints for:
//! - Health & version readiness (`GET /api/v1/health`)
//! - Standalone User-Auth authentication status & updates (`GET /api/v1/auth/status`,
//!   `POST /api/v1/auth/github-token`, `POST /api/v1/auth/workiq-account`,
//!   `POST /api/v1/auth/workiq-login`)
//! - Live message analysis & pre-send self-check (`POST /api/v1/analyze`)
//! - Instant tier animation simulation (`POST /api/v1/simulate`)
//! - On-demand WorkIQ scan and live counters (`POST /api/v1/scan/now`, `GET /api/v1/scan/progress`)
//! - Self-awareness scorecard & recent feed (`GET /api/v1/ledger`)
//! - Real-time SSE animation stream (`GET /api/v1/events/stream`)

use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{ConnectInfo, DefaultBodyLimit, Path as RoutePath, Query, State};
use axum::http::{header, HeaderName, HeaderValue, Method, StatusCode, Uri};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Extension, Json, Router};
use futures::stream::{self, Stream};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::auth::AuthCoordinator;
use crate::event_bus::{AnimationEvent, AnimationEventBus};
use crate::gmail_error::GmailError;
use crate::gmail_scanner::GmailScanner;
use crate::ledger::AwarenessLedger;
use crate::llm_luna::LunaClient;
use crate::scanner_daemon::{build_preset_sample, ScannerDaemon};
use crate::slop_detector::{
    M365App, MessageDirection, MessageSample, MonitorSide, SlopDetector, SlopReport,
};
use crate::static_files::serve_static_or_spa;
use crate::workiq_mcp::WorkIqClient;

/// Shared application state injected into Axum handlers.
#[derive(Clone)]
pub struct AppState {
    /// Background M365 scanner and analysis coordinator.
    pub daemon: Arc<ScannerDaemon>,
    /// WorkIQ MCP client.
    pub workiq: Arc<WorkIqClient>,
    /// GitHub GPT Luna (`gpt-5.6-luna`) client.
    pub luna: Arc<LunaClient>,
    /// Sent vs. received self-awareness ledger.
    pub ledger: Arc<AwarenessLedger>,
    /// Real-time animation broadcast bus.
    pub bus: Arc<AnimationEventBus>,
    /// Memory-only desktop Gmail authentication and incremental scanner.
    pub gmail: Arc<GmailScanner>,
    /// Directory containing compiled SvelteKit static assets.
    pub web_asset_dir: PathBuf,
    /// Counter for synthetic/simulated message IDs.
    pub sim_counter: Arc<AtomicU64>,
}

/// Request payload for `POST /api/v1/analyze`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
    /// M365 source application (`"teams"`, `"outlook"`, etc.).
    #[serde(default = "default_app")]
    pub app: M365App,
    /// Communication direction (`"sent"` or `"received"`).
    #[serde(default = "default_direction")]
    pub direction: MessageDirection,
    /// Display name of sender.
    #[serde(default = "default_sender")]
    pub sender: String,
    /// Subject line or Teams topic.
    #[serde(default = "default_subject")]
    pub subject_or_topic: String,
    /// Message text to analyze.
    pub body: String,
    /// Whether to also run live GitHub GPT Luna (`gpt-5.6-luna`) inference if authenticated.
    #[serde(default)]
    pub use_luna: bool,
    /// Whether to record this message in the self-awareness ledger.
    #[serde(default = "default_true")]
    pub record_in_ledger: bool,
    /// Whether to broadcast the resulting animation to the monitor overlay.
    #[serde(default = "default_true")]
    pub trigger_animation: bool,
}

fn default_app() -> M365App {
    M365App::Teams
}
fn default_direction() -> MessageDirection {
    MessageDirection::Sent
}
fn default_sender() -> String {
    "You (Pre-Send Check)".to_string()
}
fn default_subject() -> String {
    "Draft M365 Message".to_string()
}
fn default_true() -> bool {
    true
}

/// Response payload for `POST /api/v1/analyze` and `POST /api/v1/simulate`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeResponse {
    /// Full slop evaluation report.
    pub report: SlopReport,
    /// Emitted animation event if `trigger_animation` was enabled.
    pub event: Option<AnimationEvent>,
}

/// Request payload for `POST /api/v1/simulate`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulateRequest {
    /// Preset name: `"human_sparkle"`, `"peaceful_cloud"`, `"innocent_fruit"`,
    /// `"slop_splat"`, `"slop_grenade"`, or `"my_outgoing_grenade"`.
    pub preset: String,
    /// Whether to also call live GPT Luna (`gpt-5.6-luna`) during simulation.
    #[serde(default)]
    pub use_luna: bool,
}

/// Request payload for `POST /api/v1/auth/github-token`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGithubAuthRequest {
    /// Optional GitHub token to keep in memory for GPT Luna calls (`None` or empty clears session override).
    pub token: Option<String>,
    /// Optional flag to enable or disable GPT Luna semantic evaluation.
    pub enabled: Option<bool>,
}

/// Request payload for `POST /api/v1/auth/workiq-account`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWorkIqAccountRequest {
    /// Optional M365 email address passed to `workiq --account`.
    pub account: Option<String>,
}

/// Longest history refresh the dashboard can request.
const MAX_LOOKBACK_DAYS: u8 = 30;

/// Request payload for `POST /api/v1/scan/now`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanNowRequest {
    /// Whether to enrich newly discovered M365 messages with GPT Luna (`gpt-5.6-luna`).
    #[serde(default)]
    pub use_luna: bool,
    /// Days (`1..=30`) for a complete, quiet history backfill; omitted for the normal recent poll.
    pub lookback_days: Option<u8>,
    /// Optional opaque ID for metadata-only history progress.
    pub refresh_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefreshProgressQuery {
    refresh_id: Option<String>,
}

/// Request payload for `POST /api/v1/squeegee`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqueegeeRequest {
    /// Side of the monitor to wipe (`"left"` or `"right"`).
    pub side: MonitorSide,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommunicationWipe {
    data_wiped: bool,
    reset_generation: u64,
    cleared_reports: usize,
    cleared_events: usize,
    cleared_deduplication_keys: usize,
}

/// Maximum HTTP request body size (64 KiB) to prevent memory exhaustion on local or container deployments.
const MAX_REQUEST_BODY_BYTES: usize = 64 * 1024;

/// Build the complete Axum [`Router`] for the Slop Grenade daemon.
pub fn build_router(state: AppState) -> Router {
    let csp = Arc::new(content_security_policy(&state.web_asset_dir));
    let gmail = Router::new()
        .route("/api/v1/gmail/accounts", get(handle_gmail_accounts))
        .route("/api/v1/gmail/authorize", post(handle_gmail_authorize))
        .route("/api/v1/auth/google/callback", get(handle_google_callback))
        .route(
            "/api/v1/gmail/accounts/{id}/reconnect",
            post(handle_gmail_reconnect),
        )
        .route(
            "/api/v1/gmail/accounts/{id}",
            delete(handle_gmail_disconnect),
        )
        .route("/api/v1/gmail/scan", post(handle_gmail_scan))
        .route("/api/v1/gmail/events", get(handle_gmail_events))
        .layer(axum::middleware::from_fn(gmail_loopback_middleware));
    Router::new()
        .merge(gmail)
        .route("/api/v1/health", get(handle_health))
        .route("/api/v1/auth/status", get(handle_auth_status))
        .route("/api/v1/auth/github-token", post(handle_update_github_auth))
        .route(
            "/api/v1/auth/workiq-account",
            post(handle_update_workiq_account),
        )
        .route("/api/v1/auth/workiq-login", post(handle_workiq_login))
        .route("/api/v1/auth/workiq-logout", post(handle_workiq_logout))
        .route("/api/v1/ledger", get(handle_ledger))
        .route("/api/v1/events/recent", get(handle_recent_events))
        .route("/api/v1/events/stream", get(handle_sse_stream))
        .route("/api/v1/analyze", post(handle_analyze))
        .route("/api/v1/simulate", post(handle_simulate))
        .route("/api/v1/squeegee", post(handle_squeegee))
        .route("/api/v1/scan/now", post(handle_scan_now))
        .route("/api/v1/scan/progress", get(handle_refresh_progress))
        .fallback(handle_static_fallback)
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BODY_BYTES))
        .layer(axum::middleware::from_fn(move |req, next| {
            let csp = Arc::clone(&csp);
            async move { security_and_cors_middleware(req, next, &csp).await }
        }))
        .with_state(state)
}

async fn gmail_loopback_middleware(
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let mut response = if trusted_gmail_request(&req) {
        next.run(req).await
    } else {
        (
            StatusCode::FORBIDDEN,
            Json(json!({ "ok": false, "error": "Gmail is available only through the local desktop dashboard." })),
        )
            .into_response()
    };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    response
}

#[derive(Clone, Copy)]
struct GmailVisibility(bool);

fn trusted_gmail_request(req: &axum::extract::Request) -> bool {
    let peer = req.extensions().get::<ConnectInfo<SocketAddr>>();
    let authority = req
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok());
    let trusted_host = authority.is_some_and(|host| {
        host.parse::<SocketAddr>()
            .is_ok_and(|address| address.ip().is_loopback())
    });
    let trusted_origin = req.headers().get(header::ORIGIN).is_none_or(|origin| {
        origin
            .to_str()
            .is_ok_and(|origin| authority.is_some_and(|host| origin == format!("http://{host}")))
    });
    peer.is_some_and(|peer| peer.0.ip().is_loopback()) && trusted_host && trusted_origin
}

async fn security_and_cors_middleware(
    mut req: axum::extract::Request,
    next: axum::middleware::Next,
    csp: &HeaderValue,
) -> Response {
    let visibility = GmailVisibility(trusted_gmail_request(&req));
    req.extensions_mut().insert(visibility);
    let private_status = req.uri().path().starts_with("/api/v1/auth/");
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    let allowed_origin = origin
        .as_deref()
        .filter(|orig| is_allowed_origin(orig, host.as_deref()))
        .and_then(|orig| HeaderValue::from_str(orig).ok());

    if origin.is_some()
        && allowed_origin.is_none()
        && matches!(
            *req.method(),
            Method::OPTIONS | Method::POST | Method::PUT | Method::DELETE | Method::PATCH
        )
    {
        let mut res = (
            StatusCode::FORBIDDEN,
            Json(json!({ "ok": false, "error": "Cross-origin request rejected." })),
        )
            .into_response();
        attach_security_headers(res.headers_mut(), csp, None);
        return res;
    }

    if req.method() == Method::OPTIONS {
        let mut res = StatusCode::NO_CONTENT.into_response();
        attach_security_headers(res.headers_mut(), csp, allowed_origin);
        return res;
    }

    let mut res = next.run(req).await;
    attach_security_headers(res.headers_mut(), csp, allowed_origin);
    if private_status {
        res.headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    res
}

/// Check whether a browser `Origin` header is allowed to interact with the Slop Grenade API.
///
/// Allows loopback origins (`127.0.0.1`, `localhost`, `[::1]`), same-host container origins,
/// the Android WebView asset origin (`https://appassets.androidplatform.net`), and any
/// explicit `SLOP_ALLOWED_ORIGIN` override, while blocking third-party web origins.
pub fn is_allowed_origin(origin: &str, host_header: Option<&str>) -> bool {
    let trimmed = origin.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed == "https://appassets.androidplatform.net" {
        return true;
    }
    if let Ok(explicit) = std::env::var("SLOP_ALLOWED_ORIGIN") {
        let explicit = explicit.trim();
        if !explicit.is_empty() && explicit == trimmed {
            return true;
        }
    }
    if let Some(host) = host_header.map(str::trim).filter(|h| !h.is_empty()) {
        if trimmed == format!("http://{host}") || trimmed == format!("https://{host}") {
            return true;
        }
    }
    let Ok(url) = reqwest::Url::parse(trimmed) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    matches!(
        url.host_str(),
        Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
    )
}

fn attach_security_headers(
    headers: &mut axum::http::HeaderMap,
    csp: &HeaderValue,
    allowed_origin: Option<HeaderValue>,
) {
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), geolocation=(), microphone=(), payment=(), usb=()"),
    );
    headers.insert(header::CONTENT_SECURITY_POLICY, csp.clone());

    if let Some(origin_val) = allowed_origin {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin_val);
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, POST, DELETE, OPTIONS"),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("Content-Type, Authorization"),
        );
    }
}

fn content_security_policy(web_asset_dir: &Path) -> HeaderValue {
    let index = std::fs::read_to_string(web_asset_dir.join("index.html")).unwrap_or_default();
    let hashes = extract_inline_script_hashes(&index);
    let script_src = if hashes.is_empty() {
        "'self'".to_string()
    } else {
        format!("'self' {}", hashes.join(" "))
    };
    let policy = format!(
        "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; object-src 'none'; script-src {script_src}; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:"
    );
    HeaderValue::from_str(&policy).expect("CSP uses valid ASCII header tokens")
}

/// Compute `'sha256-...'` Content-Security-Policy tokens for inline `<script>` blocks in `html`.
pub fn extract_inline_script_hashes(html: &str) -> Vec<String> {
    let mut hashes = Vec::new();
    let mut remaining = html;
    while let Some(start) = remaining.find("<script") {
        let after_start = &remaining[start..];
        let Some(open_end) = after_start.find('>') else {
            break;
        };
        let open_tag = &after_start[..=open_end];
        let after_open = &after_start[open_end + 1..];
        let Some(close_start) = after_open.find("</script>") else {
            break;
        };
        if !open_tag.contains("src=") {
            let script = &after_open[..close_start];
            if !script.trim().is_empty() {
                let digest = Sha256::digest(script.as_bytes());
                hashes.push(format!("'sha256-{}'", base64_encode(&digest)));
            }
        }
        remaining = &after_open[close_start + "</script>".len()..];
    }
    hashes
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(b2 & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

async fn handle_health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "slop-grenade",
        "version": env!("CARGO_PKG_VERSION"),
        "adminAppRequired": false,
        "model": "gpt-5.6-luna"
    }))
}

async fn combined_auth_status(state: &AppState, visibility: GmailVisibility) -> Value {
    let mut status = AuthCoordinator::status(&state.workiq, &state.luna, &state.gmail).await;
    if !visibility.0 {
        status.gmail = None;
    }
    serde_json::to_value(status).unwrap_or_else(|_| json!({}))
}

async fn handle_auth_status(
    State(state): State<AppState>,
    Extension(visibility): Extension<GmailVisibility>,
) -> Json<Value> {
    Json(combined_auth_status(&state, visibility).await)
}

async fn handle_update_github_auth(
    State(state): State<AppState>,
    Extension(visibility): Extension<GmailVisibility>,
    Json(payload): Json<UpdateGithubAuthRequest>,
) -> Json<Value> {
    if payload.token.is_some() {
        state.luna.set_session_token(payload.token);
    }
    if let Some(enabled) = payload.enabled {
        state.luna.set_enabled(enabled);
    }
    Json(combined_auth_status(&state, visibility).await)
}

async fn handle_update_workiq_account(
    State(state): State<AppState>,
    Extension(visibility): Extension<GmailVisibility>,
    Json(payload): Json<UpdateWorkIqAccountRequest>,
) -> Json<Value> {
    state.workiq.set_account(payload.account);
    Json(combined_auth_status(&state, visibility).await)
}

async fn handle_workiq_login(
    State(state): State<AppState>,
    Extension(visibility): Extension<GmailVisibility>,
) -> Response {
    match state.workiq.start_interactive_login().await {
        Ok(msg) => {
            let status = combined_auth_status(&state, visibility).await;
            (
                StatusCode::OK,
                Json(json!({ "ok": true, "message": msg, "status": status })),
            )
                .into_response()
        }

        Err(err) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "ok": false, "error": err })),
        )
            .into_response(),
    }
}

async fn handle_workiq_logout(
    State(state): State<AppState>,
    Extension(visibility): Extension<GmailVisibility>,
) -> Response {
    let sign_out = state.workiq.sign_out().await;
    let wipe = match wipe_communication_data(&state).await {
        Ok(wipe) => wipe,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "ok": false, "dataWiped": false, "error": error })),
            )
                .into_response();
        }
    };
    match sign_out {
        Ok(msg) => {
            let status = combined_auth_status(&state, visibility).await;
            (
                StatusCode::OK,
                Json(json!({
                    "ok": true,
                    "message": msg,
                    "status": status,
                    "dataWiped": wipe.data_wiped,
                    "resetGeneration": wipe.reset_generation,
                    "clearedReports": wipe.cleared_reports,
                    "clearedEvents": wipe.cleared_events,
                    "clearedDeduplicationKeys": wipe.cleared_deduplication_keys,
                })),
            )
                .into_response()
        }
        Err(err) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "ok": false,
                "dataWiped": wipe.data_wiped,
                "resetGeneration": wipe.reset_generation,
                "clearedReports": wipe.cleared_reports,
                "clearedEvents": wipe.cleared_events,
                "clearedDeduplicationKeys": wipe.cleared_deduplication_keys,
                "error": err,
            })),
        )
            .into_response(),
    }
}

async fn handle_gmail_accounts(State(state): State<AppState>) -> Json<Value> {
    Json(state.gmail.status().await)
}

fn gmail_error_response(error: GmailError) -> Response {
    (
        StatusCode::from_u16(error.status_code()).unwrap_or(StatusCode::BAD_GATEWAY),
        Json(json!({ "ok": false, "error": error.safe_message() })),
    )
        .into_response()
}

async fn handle_gmail_authorize(State(state): State<AppState>) -> Response {
    match state.gmail.authorize(None).await {
        Ok(authorization) => Json(authorization).into_response(),
        Err(error) => gmail_error_response(error),
    }
}

async fn handle_gmail_reconnect(
    State(state): State<AppState>,
    RoutePath(id): RoutePath<String>,
) -> Response {
    match state.gmail.authorize(Some(&id)).await {
        Ok(authorization) => Json(authorization).into_response(),
        Err(error) => gmail_error_response(error),
    }
}

async fn handle_gmail_disconnect(
    State(state): State<AppState>,
    RoutePath(id): RoutePath<String>,
) -> Response {
    match state.gmail.disconnect(&id).await {
        Ok(()) => match wipe_communication_data(&state).await {
            Ok(wipe) => (
                StatusCode::OK,
                Json(json!({
                    "ok": true,
                    "signedOut": true,
                    "dataWiped": wipe.data_wiped,
                    "resetGeneration": wipe.reset_generation,
                    "clearedReports": wipe.cleared_reports,
                    "clearedEvents": wipe.cleared_events,
                    "clearedDeduplicationKeys": wipe.cleared_deduplication_keys,
                    "message": "Signed out of Gmail. All communication data wiped.",
                })),
            )
                .into_response(),
            Err(error) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "ok": false, "dataWiped": false, "error": error })),
            )
                .into_response(),
        },
        Err(error) => gmail_error_response(error),
    }
}

async fn wipe_communication_data(state: &AppState) -> Result<CommunicationWipe, String> {
    let _transaction = state.ledger.communication_gate().write().await;
    let m365_keys = state.daemon.clear_communication_state().await?;
    let gmail_keys = state
        .gmail
        .clear_communication_state()
        .await
        .map_err(|error| error.safe_message().to_string())?;
    let cleared_reports = state.ledger.clear()?;
    let cleared_events = state.bus.clear()?;
    let placeholder = SlopDetector::new().analyze(&build_preset_sample("human_sparkle", 0));
    let reset = state.bus.publish_data_wipe(placeholder);
    Ok(CommunicationWipe {
        data_wiped: true,
        reset_generation: reset.reset_generation,
        cleared_reports,
        cleared_events,
        cleared_deduplication_keys: m365_keys + gmail_keys,
    })
}

async fn handle_gmail_scan(State(state): State<AppState>) -> Response {
    match state.gmail.scan_once().await {
        Ok(result) => Json(result).into_response(),
        Err(error) => gmail_error_response(error),
    }
}

#[derive(Deserialize)]
struct GoogleCallback {
    state: Option<String>,
    code: Option<String>,
    error: Option<String>,
}

async fn handle_google_callback(
    State(state): State<AppState>,
    query: Result<Query<GoogleCallback>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let Ok(Query(query)) = query else {
        return (
            StatusCode::BAD_REQUEST,
            Html("<!doctype html><title>Gmail connection</title><p>Invalid authorization response. Return to the local dashboard and connect again.</p>"),
        )
            .into_response();
    };
    match state
        .gmail
        .complete_authorization(
            query.state.as_deref(),
            query.code.as_deref(),
            query.error.as_deref(),
        )
        .await
    {
        Ok(()) => (
            StatusCode::OK,
            Html("<!doctype html><title>Gmail connected</title><p>Gmail connected. You can close this tab and return to Slop Grenade.</p>"),
        )
            .into_response(),
        Err(error) => (
            StatusCode::from_u16(error.status_code()).unwrap_or(StatusCode::BAD_GATEWAY),
            Html(format!(
                "<!doctype html><title>Gmail connection</title><p>{}</p><p>Return to the local dashboard to try again.</p>",
                error.safe_message()
            )),
        )
            .into_response(),
    }
}

async fn handle_gmail_events(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = stream::unfold(state.gmail.subscribe(), |mut receiver| async move {
        match receiver.recv().await {
            Ok(()) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => Some((
                Ok(Event::default()
                    .event("gmail-status")
                    .data("{\"changed\":true}")),
                receiver,
            )),
            Err(tokio::sync::broadcast::error::RecvError::Closed) => None,
        }
    });
    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

async fn handle_ledger(State(state): State<AppState>) -> Json<Value> {
    let _transaction = state.ledger.communication_gate().read().await;
    let scorecard = state.ledger.scorecard();
    Json(serde_json::to_value(scorecard).unwrap_or_else(|_| json!({})))
}

async fn handle_recent_events(State(state): State<AppState>) -> Json<Value> {
    let _transaction = state.ledger.communication_gate().read().await;
    let events = state.bus.recent_events();
    Json(json!({ "events": events }))
}

async fn handle_analyze(
    State(state): State<AppState>,
    Json(req): Json<AnalyzeRequest>,
) -> Response {
    if req.body.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Message body must not be empty" })),
        )
            .into_response();
    }

    let seq = state.sim_counter.fetch_add(1, Ordering::SeqCst);
    let sample = MessageSample {
        message_id: format!("manual-{seq}"),
        app: req.app,
        direction: req.direction,
        sender: req.sender,
        subject_or_topic: req.subject_or_topic,
        body: req.body,
        timestamp: "2026-10-23T14:45:00Z".to_string(),
    };

    let (report, event) = state
        .daemon
        .analyze_and_dispatch(
            &sample,
            req.use_luna,
            req.record_in_ledger,
            req.trigger_animation,
        )
        .await;

    (StatusCode::OK, Json(AnalyzeResponse { report, event })).into_response()
}

async fn handle_simulate(
    State(state): State<AppState>,
    Json(req): Json<SimulateRequest>,
) -> Json<AnalyzeResponse> {
    let seq = state.sim_counter.fetch_add(1, Ordering::SeqCst);
    let sample = build_preset_sample(&req.preset, seq);
    let (report, event) = state
        .daemon
        .analyze_and_dispatch(&sample, req.use_luna, true, true)
        .await;
    Json(AnalyzeResponse { report, event })
}

async fn handle_squeegee(
    State(state): State<AppState>,
    Json(req): Json<SqueegeeRequest>,
) -> Json<Value> {
    let _transaction = state.ledger.communication_gate().read().await;
    let placeholder = SlopDetector::new().analyze(&build_preset_sample("human_sparkle", 0));
    let event = state.bus.publish_squeegee(req.side, placeholder);
    Json(json!({
        "ok": true,
        "side": req.side,
        "sequence": event.sequence
    }))
}

async fn handle_scan_now(
    State(state): State<AppState>,
    payload: Option<Json<ScanNowRequest>>,
) -> Response {
    let request = payload.map(|payload| payload.0).unwrap_or_default();
    if request
        .refresh_id
        .as_ref()
        .is_some_and(|id| request.lookback_days.is_none() || !valid_refresh_id(id))
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "error": "refreshId requires a history window and 1-64 letters, digits or hyphens." })),
        ).into_response();
    }
    if request
        .lookback_days
        .is_some_and(|days| !(1..=MAX_LOOKBACK_DAYS).contains(&days))
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "ok": false,
                "error": "lookbackDays must be between 1 and 30 when provided."
            })),
        )
            .into_response();
    }
    if request.lookback_days.is_some() && request.use_luna {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "error": "History refresh uses local scoring only." })),
        )
            .into_response();
    }
    let batch = match request.lookback_days {
        Some(days) => {
            state
                .daemon
                .refresh_history_with_id(days, request.refresh_id)
                .await
        }
        None => state.daemon.poll_workiq_once(request.use_luna).await,
    };
    match batch {
        Ok(batch) => (
            StatusCode::OK,
            Json(json!({ "ok": true, "lookbackDays": request.lookback_days, "batch": batch })),
        )
            .into_response(),
        Err(err) => (
            StatusCode::OK,
            Json(json!({
                "ok": false,
                "error": err,
                "hint": "If WorkIQ needs sign-in, run `workiq ask`; if a history refresh is active, wait for it to finish."
            })),
        )
            .into_response(),
    }
}

fn valid_refresh_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

async fn handle_refresh_progress(
    State(state): State<AppState>,
    Query(query): Query<RefreshProgressQuery>,
) -> Response {
    if query
        .refresh_id
        .as_ref()
        .is_some_and(|id| !valid_refresh_id(id))
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "error": "Invalid refresh ID." })),
        )
            .into_response();
    }
    match state.daemon.refresh_progress(query.refresh_id.as_deref()) {
        Ok(progress) => (
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            Json(json!({ "progress": progress })),
        )
            .into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "ok": false, "error": error })),
        )
            .into_response(),
    }
}

async fn handle_sse_stream(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let (rx, reset) = state.bus.subscribe_with_reset();
    let stream = stream::unfold(
        (rx, reset, 0, state.bus),
        |(mut rx, mut pending_reset, mut cursor, bus)| async move {
            loop {
                let anim_event = match pending_reset.take() {
                    Some(reset) => reset,
                    None => match rx.recv().await {
                        Ok(event) => event,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                            pending_reset = bus.latest_data_wipe();
                            continue;
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
                    },
                };
                if anim_event.sequence <= cursor {
                    continue;
                }
                cursor = anim_event.sequence;
                let payload = serde_json::to_string(&anim_event).unwrap_or_default();
                let sse_event = Event::default()
                    .id(cursor.to_string())
                    .event("animation")
                    .data(payload);
                return Some((Ok(sse_event), (rx, pending_reset, cursor, bus)));
            }
        },
    );

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

async fn handle_static_fallback(State(state): State<AppState>, uri: Uri) -> Response {
    serve_static_or_spa(&state.web_asset_dir, &uri).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::Notify;

    #[tokio::test]
    async fn wipe_waits_for_pending_manual_and_batch_analysis_then_erases_every_commit() {
        for manual in [true, false] {
            let started = Arc::new(Notify::new());
            let release = Arc::new(Notify::new());
            let app = Router::new().route(
                "/responses",
                post({
                    let started = started.clone();
                    let release = release.clone();
                    move || {
                        let started = started.clone();
                        let release = release.clone();
                        async move {
                            started.notify_one();
                            release.notified().await;
                            Json(json!({ "output": [{
                                "type": "message",
                                "content": [{
                                    "type": "output_text",
                                    "text": "{\"slopScore\":8,\"reasoning\":\"Synthetic\",\"coachingTip\":\"Synthetic\"}"
                                }]
                            }] }))
                        }
                    }
                }),
            );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let fake_luna = tokio::spawn(async move {
                axum::serve(listener, app).await.unwrap();
            });
            let workiq = Arc::new(WorkIqClient::new(
                Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")),
                None,
            ));
            let luna = Arc::new(LunaClient::new(
                format!("http://{address}/responses"),
                "synthetic".into(),
                true,
            ));
            luna.set_session_token(Some("synthetic-token".into()));
            let ledger = Arc::new(AwarenessLedger::new());
            let bus = Arc::new(AnimationEventBus::new());
            let daemon = Arc::new(ScannerDaemon::new(
                workiq.clone(),
                luna.clone(),
                ledger.clone(),
                bus.clone(),
            ));
            let state = AppState {
                gmail: Arc::new(
                    GmailScanner::new(
                        &crate::config::AppConfig::default(),
                        "http://127.0.0.1:8090/api/v1/auth/google/callback".into(),
                        ledger.clone(),
                        bus.clone(),
                    )
                    .unwrap(),
                ),
                daemon: daemon.clone(),
                workiq,
                luna: luna.clone(),
                ledger: ledger.clone(),
                bus: bus.clone(),
                web_asset_dir: PathBuf::from("nonexistent-synthetic-web"),
                sim_counter: Arc::new(AtomicU64::new(1)),
            };
            let analyzing = daemon.clone();
            let analysis = tokio::spawn(async move {
                let sample = build_preset_sample("human_sparkle", 1);
                if manual {
                    analyzing
                        .analyze_and_dispatch(&sample, true, true, true)
                        .await;
                } else {
                    analyzing.ingest_samples(vec![sample], true).await.unwrap();
                }
            });
            tokio::time::timeout(Duration::from_secs(2), started.notified())
                .await
                .expect("synthetic Luna request started");
            let wiping = tokio::spawn(async move { wipe_communication_data(&state).await });
            tokio::time::timeout(Duration::from_secs(2), async {
                while ledger.communication_gate().try_read().is_ok() {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("wipe queued behind active analysis");
            assert!(!wiping.is_finished());
            release.notify_one();
            analysis.await.unwrap();
            let wipe = wiping.await.unwrap().unwrap();
            assert_eq!(wipe.cleared_reports, 1);
            assert_eq!(wipe.cleared_events, 1);
            assert_eq!(wipe.cleared_deduplication_keys, usize::from(!manual));
            assert_eq!(ledger.scorecard().reset_generation, 1);
            assert!(ledger.scorecard().recent_reports.is_empty());
            assert!(daemon.refresh_progress(None).unwrap().is_none());
            assert!(bus.recent_events().is_empty());
            assert_eq!(bus.events_after(0).len(), 1);
            assert!(bus.events_after(0)[0].data_wiped);
            luna.set_enabled(false);
            let batch = daemon
                .ingest_samples(vec![build_preset_sample("human_sparkle", 1)], false)
                .await
                .unwrap();
            assert_eq!(batch.new_messages_analyzed, 1);
            assert_eq!(ledger.scorecard().recent_reports.len(), 1);
            assert_eq!(ledger.scorecard().reset_generation, 1);
            assert_eq!(bus.recent_events()[0].reset_generation, 1);
            fake_luna.abort();
        }
    }
}
