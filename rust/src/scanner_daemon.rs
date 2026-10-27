//! Background M365 WorkIQ scanner daemon and preset simulator.
//!
//! Polls the user's WorkIQ MCP server for new Microsoft Teams and Outlook
//! messages, deduplicates by `message_id`, runs the hybrid heuristic + GitHub
//! GPT Luna (`gpt-5.6-luna`) slop detector, updates the [`AwarenessLedger`],
//! and emits real-time monitor animations via [`AnimationEventBus`].

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};

use crate::event_bus::{AnimationEvent, AnimationEventBus};
use crate::ledger::AwarenessLedger;
use crate::llm_luna::LunaClient;
use crate::refresh_phase::RefreshPhase;
use crate::refresh_progress::RefreshProgress;
use crate::slop_detector::{MessageSample, SlopDetector, SlopReport};
use crate::workiq_mcp::WorkIqClient;

/// Heuristic score threshold (`>= 28`) that triggers Stage 2 GPT Luna semantic verification
/// when GitHub GPT Luna inference is enabled.
pub const TWO_STAGE_LUNA_THRESHOLD: u8 = 28;

/// Maximum concurrent GPT Luna verification requests during a batch scan or history refresh.
const LUNA_BATCH_CONCURRENCY: usize = 6;

/// Summary of one M365 WorkIQ scan cycle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanBatchResult {
    /// Total messages returned by WorkIQ MCP in this poll.
    pub fetched_count: usize,
    /// Number of newly discovered (previously unseen) messages analyzed.
    pub new_messages_analyzed: usize,
    /// Number of Slop Grenade animations triggered (zero for quiet history backfills).
    pub grenades_triggered: usize,
    /// Reports generated for the newly discovered messages.
    pub reports: Vec<SlopReport>,
}

/// Coordinates M365 message scanning, deduplication, scoring, and animation triggers.
pub struct ScannerDaemon {
    detector: SlopDetector,
    workiq: Arc<WorkIqClient>,
    luna: Arc<LunaClient>,
    ledger: Arc<AwarenessLedger>,
    bus: Arc<AnimationEventBus>,
    seen_ids: Mutex<HashSet<String>>,
    poll_lock: tokio::sync::Mutex<()>,
    history_lock: tokio::sync::Mutex<()>,
    refresh_progress: Mutex<Option<RefreshProgress>>,
}

impl ScannerDaemon {
    /// Construct a new [`ScannerDaemon`].
    pub fn new(
        workiq: Arc<WorkIqClient>,
        luna: Arc<LunaClient>,
        ledger: Arc<AwarenessLedger>,
        bus: Arc<AnimationEventBus>,
    ) -> Self {
        Self {
            detector: SlopDetector::new(),
            workiq,
            luna,
            ledger,
            bus,
            seen_ids: Mutex::new(HashSet::new()),
            poll_lock: tokio::sync::Mutex::new(()),
            history_lock: tokio::sync::Mutex::new(()),
            refresh_progress: Mutex::new(None),
        }
    }

    /// Analyze a single [`MessageSample`], optionally enriching with GitHub GPT Luna (`gpt-5.6-luna`),
    /// optionally recording in the [`AwarenessLedger`], and optionally broadcasting an [`AnimationEvent`].
    pub async fn analyze_and_dispatch(
        &self,
        sample: &MessageSample,
        use_luna: bool,
        record_in_ledger: bool,
        trigger_animation: bool,
    ) -> (SlopReport, Option<AnimationEvent>) {
        let mut report = self.detector.analyze(sample);

        if self.luna.is_enabled()
            && (use_luna || report.heuristic_score >= TWO_STAGE_LUNA_THRESHOLD)
        {
            if let Ok(judgment) = self.luna.evaluate_message(sample).await {
                report = self.detector.merge_luna_judgment(report, &judgment);
            }
        }

        if record_in_ledger {
            self.ledger.record(report.clone());
        }

        let event = if trigger_animation {
            Some(self.bus.publish(report.clone()))
        } else {
            None
        };

        (report, event)
    }

    /// Poll WorkIQ MCP once for new M365 messages, deduplicating by `message_id`.
    pub async fn poll_workiq_once(&self, use_luna: bool) -> Result<ScanBatchResult, String> {
        let _guard = self.poll_lock.lock().await;
        let fetched = self.workiq.poll_recent_m365_messages().await?;
        self.ingest_samples(fetched, use_luna).await
    }

    /// Merge a complete WorkIQ backfill of the last `days` days (`1..=30`) using local scoring
    /// without replaying animations.
    pub async fn refresh_history(&self, days: u8) -> Result<ScanBatchResult, String> {
        self.refresh_history_with_id(days, None).await
    }

    /// Refresh history with an opaque ID so the caller can poll its own progress.
    pub async fn refresh_history_with_id(
        &self,
        days: u8,
        refresh_id: Option<String>,
    ) -> Result<ScanBatchResult, String> {
        let _guard = self
            .history_lock
            .try_lock()
            .map_err(|_| "A history refresh is already running.".to_string())?;
        let mut progress = RefreshProgress::new(days, refresh_id);
        self.store_progress(&progress)?;
        let fetched = self
            .workiq
            .poll_history_with_progress(days, |mut update| {
                update.refresh_id = progress.refresh_id.clone();
                progress = update;
                self.store_progress(&progress)
            })
            .await;
        let batch = match fetched {
            Ok(samples) => {
                self.ingest_samples_with_animation(samples, false, false, Some(&mut progress))
                    .await
            }
            Err(error) => Err(error),
        };
        progress.phase = if batch.is_ok() {
            RefreshPhase::Completed
        } else {
            RefreshPhase::Failed
        };
        self.store_progress(&progress)?;
        batch
    }

    /// Read the last history snapshot, returning none for an unrelated refresh ID.
    pub fn refresh_progress(
        &self,
        refresh_id: Option<&str>,
    ) -> Result<Option<RefreshProgress>, String> {
        let guard = self
            .refresh_progress
            .lock()
            .map_err(|_| "Refresh progress state is unavailable.".to_string())?;
        Ok(guard
            .as_ref()
            .filter(|progress| refresh_id.is_none() || progress.refresh_id.as_deref() == refresh_id)
            .cloned())
    }

    fn store_progress(&self, progress: &RefreshProgress) -> Result<(), String> {
        *self
            .refresh_progress
            .lock()
            .map_err(|_| "Refresh progress state is unavailable.".to_string())? =
            Some(progress.clone());
        Ok(())
    }

    /// Ingest a batch of [`MessageSample`] items with deduplication (used by both live WorkIQ polling and tests).
    pub async fn ingest_samples(
        &self,
        samples: Vec<MessageSample>,
        use_luna: bool,
    ) -> Result<ScanBatchResult, String> {
        self.ingest_samples_with_animation(samples, use_luna, true, None)
            .await
    }

    async fn ingest_samples_with_animation(
        &self,
        samples: Vec<MessageSample>,
        use_luna: bool,
        trigger_animation: bool,
        mut progress: Option<&mut RefreshProgress>,
    ) -> Result<ScanBatchResult, String> {
        let fetched_count = samples.len();
        let mut new_samples = Vec::new();

        {
            let mut guard = self
                .seen_ids
                .lock()
                .map_err(|_| "Scanner deduplication state is unavailable.".to_string())?;
            for s in samples {
                if guard.insert(s.message_id.clone()) {
                    new_samples.push(s);
                }
            }
        }

        let total_new = new_samples.len();
        let mut reports = Vec::with_capacity(total_new);
        let mut grenades_triggered = 0;
        if let Some(progress) = progress.as_deref_mut() {
            progress.phase = RefreshPhase::Analyzing;
            progress.analysis_total = Some(total_new);
            progress.analyzed_count = 0;
            self.store_progress(progress)?;
        }

        let luna_enabled = self.luna.is_enabled();
        let mut stream = stream::iter(new_samples.into_iter().map(
            |sample: MessageSample| async move {
                let mut report = self.detector.analyze(&sample);
                if luna_enabled && (use_luna || report.heuristic_score >= TWO_STAGE_LUNA_THRESHOLD)
                {
                    if let Ok(judgment) = self.luna.evaluate_message(&sample).await {
                        report = self.detector.merge_luna_judgment(report, &judgment);
                    }
                }
                report
            },
        ))
        .buffered(LUNA_BATCH_CONCURRENCY);

        while let Some(report) = stream.next().await {
            self.ledger.record(report.clone());
            if trigger_animation {
                self.bus.publish(report.clone());
                if report.is_slop_grenade {
                    grenades_triggered += 1;
                }
            }
            reports.push(report);
            if let Some(progress) = progress.as_deref_mut() {
                progress.analyzed_count = reports.len();
                if reports.len() % 10 == 0 || reports.len() == total_new {
                    self.store_progress(progress)?;
                }
            }
        }

        Ok(ScanBatchResult {
            fetched_count,
            new_messages_analyzed: reports.len(),
            grenades_triggered,
            reports,
        })
    }

    /// Spawn the background M365 polling loop at the configured interval.
    pub fn spawn_background_loop(self: Arc<Self>, poll_interval_secs: u64) {
        tokio::spawn(async move {
            let mut ticker = live_poll_ticker(poll_interval_secs);
            let mut failed = false;
            loop {
                ticker.tick().await;
                match self.poll_workiq_once(false).await {
                    Ok(_) => {
                        if failed {
                            eprintln!("Live WorkIQ scanning recovered.");
                        }
                        failed = false;
                    }
                    Err(_) => {
                        // Provider errors may contain personal content; keep background logs generic.
                        if !failed {
                            eprintln!("Live WorkIQ scan failed; check the dashboard connection status or use Scan now for details.");
                        }
                        failed = true;
                    }
                }
            }
        });
    }
}

fn live_poll_ticker(poll_interval_secs: u64) -> tokio::time::Interval {
    let mut ticker = tokio::time::interval(Duration::from_secs(poll_interval_secs.max(3)));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    ticker
}

pub use slop_grenade_core::presets::build_preset_sample;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slop_detector::AnimationTier;

    #[tokio::test(start_paused = true)]
    async fn live_polling_checks_every_three_seconds_without_catch_up_bursts() {
        let mut ticker = live_poll_ticker(3);
        ticker.tick().await;
        let started = tokio::time::Instant::now();
        ticker.tick().await;
        assert_eq!(started.elapsed(), Duration::from_secs(3));
        tokio::time::advance(Duration::from_secs(12)).await;
        ticker.tick().await;
        assert!(
            tokio::time::timeout(Duration::from_millis(1), ticker.tick())
                .await
                .is_err(),
            "A slow provider must not cause a burst of queued polls"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn simultaneous_live_checks_wait_instead_of_starting_duplicate_provider_scans() {
        let workiq = Arc::new(WorkIqClient::new(
            Some(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")),
            None,
        ));
        let luna = Arc::new(LunaClient::new(
            "https://api.githubcopilot.com/responses".to_string(),
            "gpt-5.6-luna".to_string(),
            false,
        ));
        let daemon = ScannerDaemon::new(
            workiq,
            luna,
            Arc::new(AwarenessLedger::new()),
            Arc::new(AnimationEventBus::new()),
        );
        let guard = daemon.poll_lock.lock().await;
        let mut attempt = Box::pin(daemon.poll_workiq_once(false));
        assert!(tokio::time::timeout(Duration::from_millis(1), &mut attempt)
            .await
            .is_err());
        drop(guard);
        assert!(
            attempt.await.is_err(),
            "Only the non-executable fixture may be accessed"
        );
    }

    #[tokio::test]
    async fn concurrent_history_refresh_is_rejected_without_blocking_live_checks_or_losing_progress(
    ) {
        let daemon = ScannerDaemon::new(
            Arc::new(WorkIqClient::new(
                Some(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")),
                None,
            )),
            Arc::new(LunaClient::new(
                "https://api.githubcopilot.com/responses".to_string(),
                "gpt-5.6-luna".to_string(),
                false,
            )),
            Arc::new(AwarenessLedger::new()),
            Arc::new(AnimationEventBus::new()),
        );
        let _guard = daemon.history_lock.lock().await;
        let original = RefreshProgress::new(7, Some("original-refresh".to_string()));
        daemon.store_progress(&original).unwrap();
        let error = daemon
            .refresh_history_with_id(3, Some("another-refresh".to_string()))
            .await
            .unwrap_err();
        assert_eq!(error, "A history refresh is already running.");
        assert_eq!(
            daemon.refresh_progress(Some("original-refresh")).unwrap(),
            Some(original)
        );
        assert_eq!(
            daemon.refresh_progress(Some("another-refresh")).unwrap(),
            None
        );
        assert!(
            tokio::time::timeout(Duration::from_secs(2), daemon.poll_workiq_once(false))
                .await
                .unwrap()
                .is_err(),
            "History must not block a live check of the non-executable fixture"
        );
    }

    #[tokio::test]
    async fn history_backfills_merge_without_duplicates_or_replaying_effects() {
        let workiq = Arc::new(WorkIqClient::new(None, None));
        let luna = Arc::new(LunaClient::new(
            "https://api.githubcopilot.com/responses".to_string(),
            "gpt-5.6-luna".to_string(),
            false,
        ));
        let ledger = Arc::new(AwarenessLedger::new());
        let bus = Arc::new(AnimationEventBus::new());
        let daemon = ScannerDaemon::new(workiq, luna, ledger.clone(), bus.clone());
        let existing = build_preset_sample("human_sparkle", 1);
        let historical = build_preset_sample("slop_grenade", 2);
        daemon
            .ingest_samples(vec![existing.clone()], false)
            .await
            .unwrap();
        let mut progress = RefreshProgress::new(7, Some("fixture-refresh".to_string()));
        let batch = daemon
            .ingest_samples_with_animation(
                vec![existing.clone(), historical.clone()],
                false,
                false,
                Some(&mut progress),
            )
            .await
            .unwrap();
        assert_eq!(batch.new_messages_analyzed, 1);
        assert_eq!(batch.grenades_triggered, 0);
        assert_eq!(bus.recent_events().len(), 1);
        assert_eq!(ledger.scorecard().received_by_me.total_messages, 2);
        assert_eq!(progress.analysis_total, Some(1));
        assert_eq!(progress.analyzed_count, 1);
        assert_eq!(
            daemon.refresh_progress(Some("fixture-refresh")).unwrap(),
            Some(progress.clone())
        );
        let again = daemon
            .ingest_samples_with_animation(
                vec![existing, historical],
                false,
                false,
                Some(&mut progress),
            )
            .await
            .unwrap();
        assert_eq!(again.new_messages_analyzed, 0);
        assert_eq!(progress.analysis_total, Some(0));
        assert_eq!(progress.analyzed_count, 0);
        assert_eq!(ledger.scorecard().received_by_me.total_messages, 2);
    }

    #[tokio::test]
    async fn deduplicates_ingested_messages_and_triggers_expected_tiers() {
        let workiq = Arc::new(WorkIqClient::new(None, None));
        let luna = Arc::new(LunaClient::new(
            "https://api.githubcopilot.com/responses".to_string(),
            "gpt-5.6-luna".to_string(),
            false,
        ));
        let ledger = Arc::new(AwarenessLedger::new());
        let bus = Arc::new(AnimationEventBus::new());
        let daemon = ScannerDaemon::new(workiq, luna, ledger.clone(), bus.clone());

        let s1 = build_preset_sample("human_sparkle", 1);
        let s2 = build_preset_sample("slop_grenade", 2);

        let batch1 = daemon
            .ingest_samples(vec![s1.clone(), s2.clone()], false)
            .await
            .unwrap();
        assert_eq!(batch1.fetched_count, 2);
        assert_eq!(batch1.new_messages_analyzed, 2);
        assert_eq!(batch1.grenades_triggered, 1);
        assert_eq!(batch1.reports[0].tier, AnimationTier::HumanSparkle);
        assert_eq!(batch1.reports[1].tier, AnimationTier::SlopGrenade);

        // Re-ingesting the same IDs must produce 0 new animations
        let batch2 = daemon.ingest_samples(vec![s1, s2], false).await.unwrap();
        assert_eq!(batch2.new_messages_analyzed, 0);
        assert_eq!(ledger.scorecard().received_by_me.total_messages, 2);
    }

    #[tokio::test]
    async fn two_stage_luna_verifies_borderline_messages_and_vetoes_false_positives() {
        use axum::{routing::post, Json, Router};
        use serde_json::json;
        use std::sync::atomic::{AtomicUsize, Ordering};

        let calls = Arc::new(AtomicUsize::new(0));
        let calls_clone = calls.clone();
        let app = Router::new().route(
            "/responses",
            post(move || {
                let c = calls_clone.clone();
                async move {
                    c.fetch_add(1, Ordering::SeqCst);
                    Json(json!({
                        "model": "gpt-5.6-luna",
                        "output": [{
                            "type": "message",
                            "content": [{
                                "type": "output_text",
                                "text": "{\"slopScore\": 8, \"reasoning\": \"Authentic human bullet notes\", \"coachingTip\": \"Concise and clear.\"}"
                            }]
                        }]
                    }))
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let workiq = Arc::new(WorkIqClient::new(None, None));
        let luna = Arc::new(LunaClient::new(
            format!("http://{addr}/responses"),
            "gpt-5.6-luna".to_string(),
            true,
        ));
        luna.set_session_token(Some("test-session-token".to_string()));
        let ledger = Arc::new(AwarenessLedger::new());
        let bus = Arc::new(AnimationEventBus::new());
        let daemon = ScannerDaemon::new(workiq, luna, ledger, bus);

        let clear_human = build_preset_sample("human_sparkle", 10);
        let mut false_alarm = build_preset_sample("innocent_fruit", 11);
        false_alarm.body = "Hi team, notes from our call:\n\
            - **Scope:** Confirmed the three tables for phase 1.\n\
            - **Owner:** Sam is taking the ingestion script.\n\
            - **Timing:** Targeting Wednesday morning for the dry run."
            .to_string();

        let batch = daemon
            .ingest_samples(vec![clear_human, false_alarm], false)
            .await
            .unwrap();
        assert_eq!(batch.new_messages_analyzed, 2);
        // Only the message with heuristic_score >= 28 should trigger a Stage 2 Luna call
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(batch.reports[0].luna_score, None);
        assert_eq!(batch.reports[0].tier, AnimationTier::HumanSparkle);
        assert_eq!(batch.reports[1].luna_score, Some(8));
        assert!(batch.reports[1].slop_score <= 19);
        assert_eq!(batch.reports[1].tier, AnimationTier::HumanSparkle);
    }
}
