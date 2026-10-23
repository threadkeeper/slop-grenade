//! Axum HTTP + Server-Sent Events (SSE) API server for Slop Grenade.
//!
//! Exposes endpoints for:
//! - Health & version readiness (`GET /api/v1/health`)
//! - Standalone User-Auth authentication status & updates (`GET /api/v1/auth/status`,
//!   `POST /api/v1/auth/github-token`, `POST /api/v1/auth/workiq-account`,
//!   `POST /api/v1/auth/workiq-login`)
//! - Live message analysis & pre-send self-check (`POST /api/v1/analyze`)
//! - Instant tier animation simulation (`POST /api/v1/simulate`)
//! - On-demand WorkIQ MCP M365 scan (`POST /api/v1/scan/now`)
//! - Self-awareness scorecard & recent feed (`GET /api/v1/ledger`)
//! - Real-time SSE animation stream (`GET /api/v1/events/stream`)

use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::http::{HeaderValue, Method, StatusCode, Uri};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::stream::{self, Stream};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::auth::AuthCoordinator;
use crate::event_bus::{AnimationEvent, AnimationEventBus};
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

/// Request payload for `POST /api/v1/scan/now`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanNowRequest {
    /// Whether to enrich newly discovered M365 messages with GPT Luna (`gpt-5.6-luna`).
    #[serde(default)]
    pub use_luna: bool,
}

/// Request payload for `POST /api/v1/squeegee`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqueegeeRequest {
    /// Side of the monitor to wipe (`"left"` or `"right"`).
    pub side: MonitorSide,
}

/// Build the complete Axum [`Router`] for the Slop Grenade daemon.
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/health", get(handle_health))
        .route("/api/v1/auth/status", get(handle_auth_status))
        .route("/api/v1/auth/github-token", post(handle_update_github_auth))
        .route(
            "/api/v1/auth/workiq-account",
            post(handle_update_workiq_account),
        )
        .route("/api/v1/auth/workiq-login", post(handle_workiq_login))
        .route("/api/v1/ledger", get(handle_ledger))
        .route("/api/v1/events/recent", get(handle_recent_events))
        .route("/api/v1/events/stream", get(handle_sse_stream))
        .route("/api/v1/analyze", post(handle_analyze))
        .route("/api/v1/simulate", post(handle_simulate))
        .route("/api/v1/squeegee", post(handle_squeegee))
        .route("/api/v1/scan/now", post(handle_scan_now))
        .fallback(handle_static_fallback)
        .layer(axum::middleware::from_fn(cors_middleware))
        .with_state(state)
}

async fn cors_middleware(req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    if req.method() == Method::OPTIONS {
        let mut res = StatusCode::NO_CONTENT.into_response();
        attach_cors_headers(res.headers_mut());
        return res;
    }
    let mut res = next.run(req).await;
    attach_cors_headers(res.headers_mut());
    res
}

fn attach_cors_headers(headers: &mut axum::http::HeaderMap) {
    headers.insert(
        axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        axum::http::header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    headers.insert(
        axum::http::header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Content-Type, Authorization"),
    );
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

async fn handle_auth_status(State(state): State<AppState>) -> Json<Value> {
    let status = AuthCoordinator::status(&state.workiq, &state.luna).await;
    Json(serde_json::to_value(status).unwrap_or_else(|_| json!({})))
}

async fn handle_update_github_auth(
    State(state): State<AppState>,
    Json(payload): Json<UpdateGithubAuthRequest>,
) -> Json<Value> {
    if payload.token.is_some() {
        state.luna.set_session_token(payload.token);
    }
    if let Some(enabled) = payload.enabled {
        state.luna.set_enabled(enabled);
    }
    let status = AuthCoordinator::status(&state.workiq, &state.luna).await;
    Json(serde_json::to_value(status).unwrap_or_else(|_| json!({})))
}

async fn handle_update_workiq_account(
    State(state): State<AppState>,
    Json(payload): Json<UpdateWorkIqAccountRequest>,
) -> Json<Value> {
    state.workiq.set_account(payload.account);
    let status = AuthCoordinator::status(&state.workiq, &state.luna).await;
    Json(serde_json::to_value(status).unwrap_or_else(|_| json!({})))
}

async fn handle_workiq_login(State(state): State<AppState>) -> Response {
    match state.workiq.start_interactive_login().await {
        Ok(msg) => {
            let status = AuthCoordinator::status(&state.workiq, &state.luna).await;
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

async fn handle_ledger(State(state): State<AppState>) -> Json<Value> {
    let scorecard = state.ledger.scorecard();
    Json(serde_json::to_value(scorecard).unwrap_or_else(|_| json!({})))
}

async fn handle_recent_events(State(state): State<AppState>) -> Json<Value> {
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
    let use_luna = payload.map(|p| p.use_luna).unwrap_or(false);
    match state.daemon.poll_workiq_once(use_luna).await {
        Ok(batch) => (StatusCode::OK, Json(json!({ "ok": true, "batch": batch }))).into_response(),
        Err(err) => (
            StatusCode::OK,
            Json(json!({
                "ok": false,
                "error": err,
                "hint": "Run `workiq ask` to sign in with your M365 work account, then retry."
            })),
        )
            .into_response(),
    }
}

async fn handle_sse_stream(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.bus.subscribe();
    let stream = stream::unfold(rx, |mut rx| async move {
        loop {
            match rx.recv().await {
                Ok(anim_event) => {
                    let payload = serde_json::to_string(&anim_event).unwrap_or_default();
                    let sse_event = Event::default().event("animation").data(payload);
                    return Some((Ok(sse_event), rx));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
            }
        }
    });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

async fn handle_static_fallback(State(state): State<AppState>, uri: Uri) -> Response {
    serve_static_or_spa(&state.web_asset_dir, &uri).await
}
