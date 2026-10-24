//! Transport-independent native request routing.
//!
//! Disconnect clears only queued account events. Historical ledger statistics,
//! reports, and seen IDs remain until the normal process/session clear, so other
//! accounts are unaffected and reconnect cannot count the same mail twice.
//! The shell separately removes credentials, checkpoints, and scheduled work.
//! Raw Gmail metadata is transient scoring input; report metadata is redacted
//! here afterward, before responses, ledger storage, or event publication.

use std::collections::hash_map::RandomState;
use std::collections::HashSet;
use std::hash::BuildHasher;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::{json, Value};
use slop_grenade_core::event_bus::{AnimationEvent, AnimationEventBus};
use slop_grenade_core::ledger::AwarenessLedger;
use slop_grenade_core::presets::build_preset_sample;
use slop_grenade_core::slop_detector::{
    LunaJudgment, M365App, MessageDirection, MessageSample, MonitorSide, SlopDetector, SlopReport,
    SlopSignalCategory,
};

/// One ephemeral native runtime, with no IO or external inference clients.
///
/// Kotlin owns account-scoped IDs (`accountId:messageId`) and rehydrates quiet
/// history when the session ID changes. The global entrypoint keeps one runtime
/// for the process lifetime; constructing another runtime models process restart.
pub struct NativeCore {
    session_id: String,
    ledger: AwarenessLedger,
    bus: AnimationEventBus,
    seen_ids: HashSet<String>,
    next_manual_id: u64,
}

impl Default for NativeCore {
    fn default() -> Self {
        Self::new()
    }
}

impl NativeCore {
    /// Create a clean session with an empty ledger, deduplication set, and queue.
    pub fn new() -> Self {
        static SESSIONS: AtomicU64 = AtomicU64::new(1);
        let epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        Self {
            // Not an authentication secret, device identifier, or account identifier.
            session_id: format!("{epoch:x}-{:x}", SESSIONS.fetch_add(1, Ordering::Relaxed)),
            ledger: AwarenessLedger::new(),
            bus: AnimationEventBus::new(),
            seen_ids: HashSet::new(),
            next_manual_id: 1,
        }
    }

    /// Route `{method,path,body}` and return serialized `{status,body}`.
    ///
    /// Malformed payloads return 400 with static errors; unknown routes return 404.
    /// No request content, credentials, or parser diagnostics are logged.
    pub fn request(&mut self, input: &str) -> String {
        let response = match serde_json::from_str::<Request>(input) {
            Ok(request) => match self.route(request) {
                Ok(body) => json!({"status":200,"body":body}),
                Err((status, message)) => json!({"status":status,"body":{"error":message}}),
            },
            Err(_) => json!({"status":400,"body":{"error":"Invalid JSON request"}}),
        };
        response.to_string()
    }

    fn route(&mut self, request: Request) -> Result<Value, ApiError> {
        match (request.method.as_str(), request.path.as_str()) {
            ("GET", "/api/v1/health") => Ok(json!({"ok":true,"version":env!("CARGO_PKG_VERSION")})),
            ("GET", "/internal/session") => Ok(json!({"sessionId":self.session_id})),
            ("GET", "/api/v1/ledger") => Ok(json!(self.ledger.scorecard())),
            ("GET", path) if path == "/api/v1/events" || path.starts_with("/api/v1/events?") => {
                let after = match path.strip_prefix("/api/v1/events?") {
                    None => 0,
                    Some(query) => {
                        let value = query.strip_prefix("after=").ok_or(BAD_CURSOR)?;
                        if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
                            return Err(BAD_CURSOR);
                        }
                        value.parse::<u64>().map_err(|_| BAD_CURSOR)?
                    }
                };
                Ok(json!(self.bus.events_after(after)))
            }
            ("POST", "/internal/ingest") => self.ingest(decode(request.body)?),
            ("POST", "/internal/disconnect") => self.disconnect(decode(request.body)?),
            ("POST", "/api/v1/analyze") => self.analyze(decode(request.body)?),
            ("POST", "/api/v1/simulate") => {
                let payload: SimulateRequest = decode(request.body)?;
                if payload.use_luna {
                    return Err((
                        503,
                        "Luna unavailable for simulation: use explicit draft analysis",
                    ));
                }
                let sample = build_preset_sample(&payload.preset, self.next_id());
                let (report, event) = self.dispatch(&sample, None, true, true);
                Ok(json!({"report":report,"event":event}))
            }
            ("POST", "/api/v1/squeegee") => {
                let payload: SqueegeeRequest = decode(request.body)?;
                let placeholder =
                    SlopDetector::new().analyze(&build_preset_sample("human_sparkle", 0));
                let event = self
                    .bus
                    .publish_squeegee_buffered(payload.side, sanitize_report(placeholder));
                Ok(json!({"ok":true,"side":payload.side,"sequence":event.sequence}))
            }
            _ => Err((404, "Unknown native route")),
        }
    }

    fn next_id(&mut self) -> u64 {
        let id = self.next_manual_id;
        self.next_manual_id += 1;
        id
    }

    fn ingest(&mut self, payload: IngestRequest) -> Result<Value, ApiError> {
        // Validate the complete batch before changing deduplication or ledger state.
        if payload.samples.iter().any(|sample| {
            !sample
                .message_id
                .split_once(':')
                .is_some_and(|(account, id)| valid_account(account) && !id.trim().is_empty())
        }) {
            return Err((400, "Message IDs must use accountId:messageId"));
        }
        let fetched_count = payload.samples.len();
        let mut reports = Vec::new();
        let mut grenades_triggered = 0;
        for sample in payload.samples {
            if !self.seen_ids.insert(sample.message_id.clone()) {
                continue;
            }
            // Ingestion has no Luna parameter or inference path, even for live mail.
            let (report, _) = self.dispatch(&sample, None, true, !payload.quiet);
            if !payload.quiet && report.is_slop_grenade {
                grenades_triggered += 1;
            }
            reports.push(report);
        }
        Ok(json!({"ok":true,"batch":{
            "fetchedCount":fetched_count,
            "newMessagesAnalyzed":reports.len(),
            "grenadesTriggered":grenades_triggered,
            "reports":reports
        }}))
    }

    fn disconnect(&mut self, payload: DisconnectRequest) -> Result<Value, ApiError> {
        if !valid_account(&payload.account_id) {
            return Err((400, "Invalid account ID"));
        }
        // Disconnect is not historical deletion. In particular, never rebuild
        // all-time counters from the bounded recent feed or erase dedup IDs.
        let queued_before = self.bus.recent_events().len();
        self.bus.remove_account(&payload.account_id);
        let cleared_events = queued_before - self.bus.recent_events().len();
        Ok(json!({
            "ok":true,
            "historyRetained":true,
            "clearedEvents":cleared_events,
            "removedIds":0,
            "removedReports":0,
            "totalsRecomputedFromRetained":false
        }))
    }

    fn analyze(&mut self, payload: AnalyzeRequest) -> Result<Value, ApiError> {
        if payload.body.trim().is_empty() {
            return Err((400, "Message body must not be empty"));
        }
        if payload.use_luna && payload.luna_judgment.is_none() {
            return Err((
                503,
                "Luna unavailable: Android must supply an explicit lunaJudgment",
            ));
        }
        let sample = MessageSample {
            message_id: format!("manual-{}", self.next_id()),
            app: payload.app,
            direction: payload.direction,
            sender: payload.sender,
            subject_or_topic: payload.subject_or_topic,
            body: payload.body,
            timestamp: chrono::Utc::now().to_rfc3339(),
        };
        let (report, event) = self.dispatch(
            &sample,
            payload.luna_judgment.as_ref(),
            payload.record_in_ledger,
            payload.trigger_animation,
        );
        Ok(json!({"report":report,"event":event}))
    }

    fn dispatch(
        &self,
        sample: &MessageSample,
        judgment: Option<&LunaJudgment>,
        record: bool,
        animate: bool,
    ) -> (SlopReport, Option<AnimationEvent>) {
        let detector = SlopDetector::new();
        let mut report = detector.analyze(sample);
        if let Some(judgment) = judgment {
            report = detector.merge_luna_judgment(report, judgment);
        }
        let report = sanitize_report(report);
        if record {
            self.ledger.record(report.clone());
        }
        let event = animate.then(|| self.bus.publish(report.clone()));
        (report, event)
    }
}

type ApiError = (u16, &'static str);
const BAD_CURSOR: ApiError = (400, "after must be an unsigned sequence number");

fn decode<T: serde::de::DeserializeOwned>(body: Value) -> Result<T, ApiError> {
    serde_json::from_value(body).map_err(|_| (400, "Invalid request body"))
}

fn valid_account(account: &str) -> bool {
    !account.trim().is_empty() && account.trim() == account && !account.contains(':')
}

fn sanitize_report(mut report: SlopReport) -> SlopReport {
    // Preserve scoring and schema, but do not retain verbatim body fragments.
    // Sender/subject automation checks must already have run on unmodified
    // transient samples. Never redact inputs before the detector sees them.
    if report.app == M365App::Gmail {
        static SENDER_HASHER: OnceLock<RandomState> = OnceLock::new();
        let normalized_sender = report.sender.trim().to_lowercase();
        // Process-keyed, never persisted, and independent of account/message IDs
        // so the same sender still groups across connected Gmail accounts.
        let pseudonym = SENDER_HASHER
            .get_or_init(RandomState::new)
            .hash_one(normalized_sender);
        report.sender = format!("Gmail sender {pseudonym:016x}");
        report.subject_or_topic = "Gmail message".into();
    }
    report.redacted_preview = "[Message content kept ephemeral]".into();
    for signal in &mut report.signals {
        signal.excerpt.clear();
        if signal.category == SlopSignalCategory::LunaSemantic {
            signal.label = "Explicit Luna semantic evaluation".into();
        }
    }
    if report.luna_score.is_some() {
        report.self_awareness_tip =
            "Review the concrete decision and rewrite in your own words.".into();
    }
    report
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    method: String,
    path: String,
    #[serde(default)]
    body: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IngestRequest {
    samples: Vec<MessageSample>,
    quiet: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DisconnectRequest {
    account_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeRequest {
    #[serde(default = "default_app")]
    app: M365App,
    #[serde(default = "default_direction")]
    direction: MessageDirection,
    #[serde(default = "default_sender")]
    sender: String,
    #[serde(default = "default_subject")]
    subject_or_topic: String,
    body: String,
    #[serde(default)]
    use_luna: bool,
    #[serde(default)]
    luna_judgment: Option<LunaJudgment>,
    #[serde(default = "default_true")]
    record_in_ledger: bool,
    #[serde(default = "default_true")]
    trigger_animation: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SimulateRequest {
    preset: String,
    #[serde(default)]
    use_luna: bool,
}

#[derive(Deserialize)]
struct SqueegeeRequest {
    side: MonitorSide,
}

fn default_app() -> M365App {
    M365App::Teams
}

fn default_direction() -> MessageDirection {
    MessageDirection::Sent
}

fn default_sender() -> String {
    "You (Pre-Send Check)".into()
}

fn default_subject() -> String {
    "Draft M365 Message".into()
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    //! Native routing regressions using synthetic, in-memory message fixtures.
    #![forbid(unsafe_code)]
    #![deny(missing_docs)]

    use super::*;
    use serde_json::{json, Value};
    use slop_grenade_core::presets::build_preset_sample;
    use slop_grenade_core::slop_detector::{M365App, SlopDetector};

    fn call(core: &mut NativeCore, method: &str, path: &str, body: Value) -> Value {
        serde_json::from_str(
            &core.request(&json!({"method":method,"path":path,"body":body}).to_string()),
        )
        .unwrap()
    }

    fn sample(id: &str, preset: &str) -> Value {
        let mut sample = build_preset_sample(preset, 1);
        sample.app = M365App::Gmail;
        sample.message_id = id.into();
        serde_json::to_value(sample).unwrap()
    }

    #[test]
    fn health_reports_native_package_version_without_mutating_session() {
        let mut core = NativeCore::new();
        let before = call(&mut core, "GET", "/internal/session", Value::Null);
        let response = call(&mut core, "GET", "/api/v1/health", Value::Null);
        assert_eq!(
            response,
            json!({
                "status":200,
                "body":{"ok":true,"version":env!("CARGO_PKG_VERSION")}
            })
        );
        assert_eq!(
            call(&mut core, "GET", "/internal/session", Value::Null),
            before
        );
        assert_eq!(
            call(&mut core, "GET", "/api/v1/events", Value::Null)["body"],
            json!([])
        );
        assert_eq!(
            call(&mut core, "GET", "/api/v1/ledger", Value::Null)["body"]["sentByMe"]
                ["totalMessages"],
            0
        );
        assert_eq!(
            call(&mut core, "GET", "/api/v1/ledger", Value::Null)["body"]["receivedByMe"]
                ["totalMessages"],
            0
        );
    }

    #[test]
    fn quiet_history_deduplicates_within_and_across_batches_without_luna_or_events() {
        let mut core = NativeCore::new();
        let message = sample("a:1", "slop_grenade");
        let first = call(
            &mut core,
            "POST",
            "/internal/ingest",
            json!({"samples":[message.clone(),message.clone()],"quiet":true}),
        );
        assert_eq!(first["status"], 200);
        assert_eq!(first["body"]["batch"]["fetchedCount"], 2);
        assert_eq!(first["body"]["batch"]["newMessagesAnalyzed"], 1);
        assert_eq!(first["body"]["batch"]["grenadesTriggered"], 0);
        assert!(first["body"]["batch"]["reports"][0]["lunaScore"].is_null());
        let second = call(
            &mut core,
            "POST",
            "/internal/ingest",
            json!({"samples":[message],"quiet":false}),
        );
        assert_eq!(second["body"]["batch"]["newMessagesAnalyzed"], 0);
        assert_eq!(
            call(&mut core, "GET", "/api/v1/events?after=0", Value::Null)["body"],
            json!([])
        );
        assert_eq!(
            call(&mut core, "GET", "/api/v1/ledger", Value::Null)["body"]["receivedByMe"]
                ["totalMessages"],
            1
        );
    }

    #[test]
    fn live_events_are_repeatable_bounded_and_include_squeegee() {
        let mut core = NativeCore::new();
        for n in 0..40 {
            let result = call(
                &mut core,
                "POST",
                "/internal/ingest",
                json!({"samples":[sample(&format!("a:{n}"),"slop_grenade")],"quiet":false}),
            );
            assert_eq!(result["body"]["batch"]["grenadesTriggered"], 1);
        }
        let all = call(&mut core, "GET", "/api/v1/events?after=0", Value::Null);
        assert_eq!(all["body"].as_array().unwrap().len(), 32);
        assert_eq!(all["body"][0]["sequence"], 9);
        assert_eq!(
            all,
            call(&mut core, "GET", "/api/v1/events?after=0", Value::Null)
        );
        let wipe = call(
            &mut core,
            "POST",
            "/api/v1/squeegee",
            json!({"side":"right"}),
        );
        assert_eq!(wipe["body"]["ok"], true);
        assert_eq!(wipe["body"]["sequence"], 41);
        let events = call(&mut core, "GET", "/api/v1/events?after=40", Value::Null);
        assert_eq!(events["body"].as_array().unwrap().len(), 1);
        assert_eq!(events["body"][0]["squeegeeSide"], "right");
        assert_eq!(
            call(&mut core, "GET", "/api/v1/ledger", Value::Null)["body"]["receivedByMe"]
                ["totalMessages"],
            40
        );
    }

    #[test]
    fn disconnect_only_clears_exact_account_events_and_retains_history_and_dedup() {
        let mut core = NativeCore::new();
        call(
            &mut core,
            "POST",
            "/internal/ingest",
            json!({
                "samples":[sample("a:1","human_sparkle"),sample("ab:1","human_sparkle"),
                           sample("b:1","slop_grenade")],"quiet":false
            }),
        );
        let before = call(&mut core, "GET", "/api/v1/ledger", Value::Null);
        let removed = call(
            &mut core,
            "POST",
            "/internal/disconnect",
            json!({"accountId":"a"}),
        );
        assert_eq!(removed["status"], 200);
        assert_eq!(removed["body"]["removedIds"], 0);
        assert_eq!(removed["body"]["removedReports"], 0);
        assert_eq!(removed["body"]["totalsRecomputedFromRetained"], false);
        assert_eq!(removed["body"]["historyRetained"], true);
        assert_eq!(removed["body"]["clearedEvents"], 1);
        let ledger = call(&mut core, "GET", "/api/v1/ledger", Value::Null);
        assert_eq!(ledger, before);
        let events = call(&mut core, "GET", "/api/v1/events", Value::Null);
        assert_eq!(events["body"].as_array().unwrap().len(), 2);
        assert!(events["body"]
            .as_array()
            .unwrap()
            .iter()
            .all(|event| event["report"]["messageId"] != "a:1"));
        let restored = call(
            &mut core,
            "POST",
            "/internal/ingest",
            json!({
                "samples":[sample("a:1","human_sparkle"),sample("b:1","slop_grenade")],"quiet":true
            }),
        );
        assert_eq!(restored["body"]["batch"]["newMessagesAnalyzed"], 0);
        assert_eq!(
            call(&mut core, "GET", "/api/v1/ledger", Value::Null),
            before
        );
        assert_eq!(
            call(
                &mut core,
                "POST",
                "/internal/disconnect",
                json!({"accountId":"missing"})
            )["body"]["removedReports"],
            0
        );
    }

    #[test]
    fn disconnect_preserves_all_time_totals_and_streaks_beyond_retained_history() {
        let mut core = NativeCore::new();
        let history: Vec<Value> = (0..400)
            .map(|n| {
                let mut message = sample(&format!("b:{n}"), "human_sparkle");
                message["timestamp"] = json!("2020-01-01T12:00:00Z");
                message
            })
            .collect();
        call(
            &mut core,
            "POST",
            "/internal/ingest",
            json!({"samples":history,"quiet":true}),
        );
        call(
            &mut core,
            "POST",
            "/internal/ingest",
            json!({
                "samples":[sample("a:1","slop_grenade"),sample("ab:1","human_sparkle")],
                "quiet":false
            }),
        );
        let before = call(&mut core, "GET", "/api/v1/ledger", Value::Null);
        assert_eq!(before["body"]["receivedByMe"]["totalMessages"], 402);
        assert!(before["body"]["recentReports"].as_array().unwrap().len() < 402);
        let disconnected = call(
            &mut core,
            "POST",
            "/internal/disconnect",
            json!({"accountId":"a"}),
        );
        assert_eq!(disconnected["body"]["clearedEvents"], 1);
        assert_eq!(
            call(&mut core, "GET", "/api/v1/ledger", Value::Null),
            before
        );
        let replay = call(
            &mut core,
            "POST",
            "/internal/ingest",
            json!({
                "samples":[sample("a:1","slop_grenade"),sample("b:0","human_sparkle")],
                "quiet":false
            }),
        );
        assert_eq!(replay["body"]["batch"]["newMessagesAnalyzed"], 0);
        assert_eq!(
            call(&mut core, "GET", "/api/v1/ledger", Value::Null),
            before
        );
        let remaining = call(&mut core, "GET", "/api/v1/events", Value::Null);
        assert_eq!(remaining["body"].as_array().unwrap().len(), 1);
        assert_eq!(remaining["body"][0]["report"]["messageId"], "ab:1");
        let repeated = call(
            &mut core,
            "POST",
            "/internal/disconnect",
            json!({"accountId":"a"}),
        );
        assert_eq!(repeated["body"]["clearedEvents"], 0);
        assert_eq!(
            call(&mut core, "GET", "/api/v1/ledger", Value::Null),
            before
        );
    }

    #[test]
    fn new_runtime_has_new_session_empty_ledger_and_reset_dedup() {
        let mut first = NativeCore::new();
        let session = call(&mut first, "GET", "/internal/session", Value::Null);
        assert_eq!(
            session,
            call(&mut first, "GET", "/internal/session", Value::Null)
        );
        call(
            &mut first,
            "POST",
            "/internal/ingest",
            json!({
                "samples":[sample("a:1","human_sparkle")],"quiet":true
            }),
        );
        let mut restarted = NativeCore::new();
        assert_ne!(
            session["body"]["sessionId"],
            call(&mut restarted, "GET", "/internal/session", Value::Null)["body"]["sessionId"]
        );
        assert_eq!(
            call(&mut restarted, "GET", "/api/v1/ledger", Value::Null)["body"]["receivedByMe"]
                ["totalMessages"],
            0
        );
        assert_eq!(
            call(&mut restarted, "GET", "/api/v1/events", Value::Null)["body"],
            json!([])
        );
        let restored = call(
            &mut restarted,
            "POST",
            "/internal/ingest",
            json!({
                "samples":[sample("a:1","human_sparkle")],"quiet":true
            }),
        );
        assert_eq!(restored["body"]["batch"]["newMessagesAnalyzed"], 1);
    }

    #[test]
    fn analyze_supports_explicit_judgment_and_independent_side_effect_flags() {
        let mut core = NativeCore::new();
        let result = call(
            &mut core,
            "POST",
            "/api/v1/analyze",
            json!({
                "app":"gmail","body":"Fixed it. Thanks!","recordInLedger":false,
                "triggerAnimation":false,"useLuna":true,"lunaJudgment":{
                    "slopScore":92,"model":"explicit-fixture","reasoning":"Synthetic judgment",
                    "coachingTip":"Add the concrete decision."
                }
            }),
        );
        assert_eq!(result["status"], 200);
        assert_eq!(result["body"]["report"]["app"], "gmail");
        assert_eq!(result["body"]["report"]["direction"], "sent");
        assert_eq!(result["body"]["report"]["lunaScore"], 92);
        assert!(result["body"]["event"].is_null());
        assert_eq!(
            call(&mut core, "GET", "/api/v1/ledger", Value::Null)["body"]["sentByMe"]
                ["totalMessages"],
            0
        );
        let result = call(
            &mut core,
            "POST",
            "/api/v1/analyze",
            json!({"body":"Fixed it. Thanks!","useLuna":false}),
        );
        assert_eq!(result["body"]["report"]["app"], "teams");
        assert!(result["body"]["report"]["lunaScore"].is_null());
        assert_eq!(result["body"]["event"]["sequence"], 1);
        assert_eq!(
            call(&mut core, "GET", "/api/v1/ledger", Value::Null)["body"]["sentByMe"]
                ["totalMessages"],
            1
        );
    }

    #[test]
    fn requested_luna_without_shell_judgment_fails_explicitly_without_side_effects() {
        let mut core = NativeCore::new();
        let response = call(
            &mut core,
            "POST",
            "/api/v1/analyze",
            json!({"body":"Synthetic draft","useLuna":true}),
        );
        assert_eq!(response["status"], 503);
        assert_eq!(
            response["body"]["error"],
            "Luna unavailable: Android must supply an explicit lunaJudgment"
        );
        assert!(response["body"].get("report").is_none());
        assert_eq!(
            call(&mut core, "GET", "/api/v1/ledger", Value::Null)["body"]["sentByMe"]
                ["totalMessages"],
            0
        );
        assert_eq!(
            call(&mut core, "GET", "/api/v1/events", Value::Null)["body"],
            json!([])
        );
        let local = call(
            &mut core,
            "POST",
            "/api/v1/analyze",
            json!({"body":"Synthetic draft"}),
        );
        assert_eq!(local["body"]["report"]["messageId"], "manual-1");
        assert_eq!(local["body"]["event"]["sequence"], 1);
    }

    #[test]
    fn explicit_luna_keeps_desktop_response_shape_and_independent_side_effect_flags() {
        for record in [false, true] {
            for animate in [false, true] {
                let mut core = NativeCore::new();
                let response = call(
                    &mut core,
                    "POST",
                    "/api/v1/analyze",
                    json!({
                        "body":"Synthetic draft","useLuna":true,
                        "recordInLedger":record,"triggerAnimation":animate,
                        "lunaJudgment":{
                            "slopScore":92,"model":"gpt-5.6-luna",
                            "reasoning":"Synthetic evaluation","coachingTip":"Be concrete."
                        }
                    }),
                );
                assert_eq!(response["status"], 200);
                assert_eq!(response["body"].as_object().unwrap().len(), 2);
                assert_eq!(response["body"]["report"]["lunaScore"], 92);
                assert_eq!(response["body"]["event"].is_object(), animate);
                assert_eq!(
                    call(&mut core, "GET", "/api/v1/ledger", Value::Null)["body"]["sentByMe"]
                        ["totalMessages"],
                    usize::from(record)
                );
                assert_eq!(
                    call(&mut core, "GET", "/api/v1/events", Value::Null)["body"]
                        .as_array()
                        .unwrap()
                        .len(),
                    usize::from(animate)
                );
            }
        }
    }

    #[test]
    fn simulation_does_not_silently_ignore_requested_luna() {
        let mut core = NativeCore::new();
        let response = call(
            &mut core,
            "POST",
            "/api/v1/simulate",
            json!({"preset":"slop_grenade","useLuna":true}),
        );
        assert_eq!(response["status"], 503);
        assert!(response["body"]["error"].as_str().unwrap().contains("Luna"));
        assert_eq!(
            call(&mut core, "GET", "/api/v1/events", Value::Null)["body"],
            json!([])
        );
    }

    #[test]
    fn simulate_scores_match_shared_desktop_presets() {
        let mut core = NativeCore::new();
        for preset in [
            "human_sparkle",
            "peaceful_cloud",
            "innocent_fruit",
            "slop_splat",
            "slop_grenade",
            "my_outgoing_grenade",
            "unknown",
        ] {
            let response = call(
                &mut core,
                "POST",
                "/api/v1/simulate",
                json!({"preset":preset}),
            );
            let expected = SlopDetector::new().analyze(&build_preset_sample(preset, 1));
            assert_eq!(response["status"], 200);
            assert_eq!(response["body"]["report"]["slopScore"], expected.slop_score);
            assert_eq!(
                response["body"]["report"]["tier"],
                serde_json::to_value(expected.tier).unwrap()
            );
            assert!(response["body"]["event"].is_object());
        }
    }

    #[test]
    fn malformed_requests_fail_privately_and_ingestion_validates_atomically() {
        let mut core = NativeCore::new();
        for input in [
            "",
            "{",
            "[]",
            "null",
            r#"{"method":1,"path":"/api/v1/ledger"}"#,
            r#"{"method":"POST","path":"/api/v1/analyze","body":{"body":"   "}}"#,
        ] {
            let response: Value = serde_json::from_str(&core.request(input)).unwrap();
            assert_eq!(response["status"], 400);
        }
        for path in [
            "/api/v1/events?after=-1",
            "/api/v1/events?after=x",
            "/api/v1/events?after=18446744073709551616",
            "/api/v1/events?after=1&extra=2",
        ] {
            assert_eq!(call(&mut core, "GET", path, Value::Null)["status"], 400);
        }
        for body in [
            json!({"samples":[sample("a:1","human_sparkle"),
                                     sample("unscoped","human_sparkle")],"quiet":true}),
            json!({"samples":[],"quiet":"not-a-boolean"}),
            json!({"samples":[],"quiet":true,"lunaJudgment":{"secret":"sensitive-fixture"}}),
        ] {
            let response = call(&mut core, "POST", "/internal/ingest", body);
            assert_eq!(response["status"], 400);
            assert!(!response.to_string().contains("sensitive-fixture"));
        }
        for account in ["", " ", "a:b"] {
            assert_eq!(
                call(
                    &mut core,
                    "POST",
                    "/internal/disconnect",
                    json!({"accountId":account})
                )["status"],
                400
            );
        }
        assert_eq!(
            call(&mut core, "GET", "/api/v1/ledger", Value::Null)["body"]["receivedByMe"]
                ["totalMessages"],
            0
        );
        assert_eq!(
            call(&mut core, "GET", "/unknown", Value::Null)["status"],
            404
        );
        assert_eq!(
            call(&mut core, "DELETE", "/api/v1/ledger", Value::Null)["status"],
            404
        );
    }

    #[test]
    fn retained_reports_do_not_keep_raw_bodies_or_signal_excerpts() {
        let mut core = NativeCore::new();
        call(
            &mut core,
            "POST",
            "/api/v1/analyze",
            json!({
                "body":"PRIVATE_FIXTURE_9483 I hope this email finds you well. Furthermore, holistic synergy."
            }),
        );
        for path in ["/api/v1/ledger", "/api/v1/events"] {
            let response = call(&mut core, "GET", path, Value::Null);
            assert!(!response.to_string().contains("PRIVATE_FIXTURE_9483"));
        }
    }

    #[test]
    fn empty_gmail_ingest_allows_followups_and_account_scoped_dedup_without_raw_output() {
        let mut core = NativeCore::new();
        let mut empty = sample("a:empty", "human_sparkle");
        empty["body"] = json!("");
        empty["sender"] = json!("noreply@empty-private-fixture.invalid");
        empty["subjectOrTopic"] = json!("EMPTY_PRIVATE_TOPIC");
        let first = call(
            &mut core,
            "POST",
            "/internal/ingest",
            json!({"samples":[empty.clone()],"quiet":true}),
        );
        assert_eq!(first["status"], 200);
        assert_eq!(first["body"]["batch"]["newMessagesAnalyzed"], 1);
        assert_eq!(
            call(&mut core, "GET", "/api/v1/events", Value::Null)["body"],
            json!([])
        );
        let mut other = empty.clone();
        other["messageId"] = json!("b:empty");
        let next = call(
            &mut core,
            "POST",
            "/internal/ingest",
            json!({"samples":[empty.clone(), sample("a:normal","slop_grenade"), other.clone(), other],"quiet":false}),
        );
        assert_eq!(next["status"], 200);
        assert_eq!(next["body"]["batch"]["fetchedCount"], 4);
        assert_eq!(next["body"]["batch"]["newMessagesAnalyzed"], 2);
        assert_eq!(next["body"]["batch"]["grenadesTriggered"], 1);
        assert_eq!(
            first["body"]["batch"]["reports"][0]["sender"],
            next["body"]["batch"]["reports"][1]["sender"]
        );
        let repeated = call(
            &mut core,
            "POST",
            "/internal/ingest",
            json!({"samples":[empty],"quiet":false}),
        );
        assert_eq!(repeated["body"]["batch"]["newMessagesAnalyzed"], 0);
        let ledger = call(&mut core, "GET", "/api/v1/ledger", Value::Null);
        assert_eq!(ledger["body"]["receivedByMe"]["totalMessages"], 3);
        let events = call(&mut core, "GET", "/api/v1/events", Value::Null);
        assert_eq!(events["body"].as_array().unwrap().len(), 2);
        for result in [first, next, repeated, ledger, events] {
            let output = result.to_string();
            assert!(!output.contains("empty-private-fixture"));
            assert!(!output.contains("EMPTY_PRIVATE_TOPIC"));
        }
    }

    #[test]
    fn gmail_automated_metadata_is_scored_before_report_redaction() {
        for (sender, subject) in [
            (
                "noreply@sender-private-fixture.invalid",
                "PRIVATE_TOPIC_SENTINEL",
            ),
            (
                "sender-private-fixture@example.invalid",
                "Automatic reply: PRIVATE_TOPIC_SENTINEL",
            ),
        ] {
            let mut core = NativeCore::new();
            let mut message = sample("account:automated", "slop_grenade");
            message["body"] = json!(format!(
                "PRIVATE_AUTOMATED_BODY_SENTINEL {}",
                message["body"].as_str().unwrap()
            ));
            message["sender"] = json!(sender);
            message["subjectOrTopic"] = json!(subject);
            let raw: MessageSample = serde_json::from_value(message.clone()).unwrap();
            assert_eq!(SlopDetector::new().analyze(&raw).slop_score, 4);
            let response = call(
                &mut core,
                "POST",
                "/internal/ingest",
                json!({"samples":[message],"quiet":false}),
            );
            let report = &response["body"]["batch"]["reports"][0];
            assert_eq!(report["slopScore"], 4);
            assert_eq!(report["tier"], "human_sparkle");
            assert_eq!(response["body"]["batch"]["grenadesTriggered"], 0);
            assert_eq!(report["subjectOrTopic"], "Gmail message");
            assert!(report["sender"]
                .as_str()
                .unwrap()
                .starts_with("Gmail sender "));
            for result in [
                response,
                call(&mut core, "GET", "/api/v1/ledger", Value::Null),
                call(&mut core, "GET", "/api/v1/events", Value::Null),
            ] {
                let json = result.to_string();
                assert!(!json.contains(sender));
                assert!(!json.contains(subject));
                assert!(!json.contains("PRIVATE_TOPIC_SENTINEL"));
                assert!(!json.contains("PRIVATE_AUTOMATED_BODY_SENTINEL"));
            }
        }
    }

    #[test]
    fn gmail_sender_pseudonyms_group_across_accounts_and_do_not_retain_topics() {
        let mut core = NativeCore::new();
        let mut messages = Vec::new();
        for (id, sender) in [
            ("a:1", "Person <private-grouping-fixture@example.invalid>"),
            ("b:1", " person <PRIVATE-GROUPING-FIXTURE@EXAMPLE.INVALID> "),
            ("b:2", "Different <other-private-fixture@example.invalid>"),
        ] {
            let mut message = sample(id, "human_sparkle");
            message["sender"] = json!(sender);
            message["subjectOrTopic"] = json!("PRIVATE_GROUPING_TOPIC");
            messages.push(message);
        }
        let response = call(
            &mut core,
            "POST",
            "/internal/ingest",
            json!({"samples":messages,"quiet":false}),
        );
        let reports = response["body"]["batch"]["reports"].as_array().unwrap();
        assert_eq!(reports[0]["sender"], reports[1]["sender"]);
        assert_ne!(reports[0]["sender"], reports[2]["sender"]);
        let pseudonym = reports[0]["sender"].clone();
        // A manual analysis and another native runtime in this process share
        // the same process key, rather than an account- or request-specific key.
        let mut same_process = NativeCore::new();
        let manual = call(
            &mut same_process,
            "POST",
            "/api/v1/analyze",
            json!({
                "app":"gmail","sender":"Person <private-grouping-fixture@example.invalid>",
                "subjectOrTopic":"PRIVATE_GROUPING_TOPIC","body":"Synthetic draft"
            }),
        );
        assert_eq!(manual["body"]["report"]["sender"], pseudonym);
        for result in [
            response,
            manual,
            call(&mut core, "GET", "/api/v1/ledger", Value::Null),
            call(&mut core, "GET", "/api/v1/events", Value::Null),
        ] {
            let json = result.to_string().to_lowercase();
            assert!(!json.contains("private-grouping-fixture"));
            assert!(!json.contains("other-private-fixture"));
            assert!(!json.contains("private_grouping_topic"));
        }
        let ledger = call(&mut core, "GET", "/api/v1/ledger", Value::Null);
        assert!(ledger["body"]["topPDoomers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|person| person["name"] == pseudonym && person["messageCount"] == 2));
    }

    #[test]
    fn gmail_draft_automatic_reply_subject_still_suppresses_grenade_before_redaction() {
        let mut core = NativeCore::new();
        let draft = build_preset_sample("slop_grenade", 1);
        let response = call(
            &mut core,
            "POST",
            "/api/v1/analyze",
            json!({
                "app":"gmail","sender":"private-draft-fixture@example.invalid",
                "subjectOrTopic":"Automatic reply: PRIVATE_DRAFT_TOPIC","body":draft.body
            }),
        );
        assert_eq!(response["status"], 200);
        assert_eq!(response["body"]["report"]["slopScore"], 4);
        assert_eq!(response["body"]["report"]["tier"], "human_sparkle");
        assert_eq!(
            response["body"]["report"]["subjectOrTopic"],
            "Gmail message"
        );
        for result in [
            response,
            call(&mut core, "GET", "/api/v1/ledger", Value::Null),
            call(&mut core, "GET", "/api/v1/events", Value::Null),
        ] {
            let json = result.to_string();
            assert!(!json.contains("private-draft-fixture"));
            assert!(!json.contains("PRIVATE_DRAFT_TOPIC"));
        }
    }

    #[test]
    fn explicit_luna_free_text_is_not_retained_as_message_content() {
        let mut core = NativeCore::new();
        let response = call(
            &mut core,
            "POST",
            "/api/v1/analyze",
            json!({
                "body":"Synthetic draft",
                "lunaJudgment":{
                    "slopScore":95,"model":"PRIVATE_FIXTURE_5",
                    "reasoning":"PRIVATE_FIXTURE_5","coachingTip":"PRIVATE_FIXTURE_5"
                }
            }),
        );
        assert_eq!(response["status"], 200);
        assert_eq!(response["body"]["report"]["lunaScore"], 95);
        for response in [
            response,
            call(&mut core, "GET", "/api/v1/ledger", Value::Null),
            call(&mut core, "GET", "/api/v1/events", Value::Null),
        ] {
            assert!(!response.to_string().contains("PRIVATE_FIXTURE_5"));
        }
    }
}
