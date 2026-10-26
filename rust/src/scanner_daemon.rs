//! Background M365 WorkIQ scanner daemon and preset simulator.
//!
//! Polls the user's WorkIQ MCP server for new Microsoft Teams and Outlook
//! messages, deduplicates by `message_id`, runs the hybrid heuristic + GitHub
//! GPT Luna (`gpt-5.6-luna`) slop detector, updates the [`AwarenessLedger`],
//! and emits real-time monitor animations via [`AnimationEventBus`].

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::event_bus::{AnimationEvent, AnimationEventBus};
use crate::ledger::AwarenessLedger;
use crate::llm_luna::LunaClient;
use crate::slop_detector::{MessageSample, SlopDetector, SlopReport};
use crate::workiq_mcp::WorkIqClient;

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

        if use_luna && self.luna.is_enabled() {
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
        let fetched = self.workiq.poll_recent_m365_messages().await?;
        self.ingest_samples(fetched, use_luna).await
    }

    /// Merge a complete WorkIQ backfill of the last `days` days (`1..=30`) using local scoring
    /// without replaying animations.
    pub async fn refresh_history(&self, days: u8) -> Result<ScanBatchResult, String> {
        let fetched = self.workiq.poll_history(days).await?;
        self.ingest_samples_with_animation(fetched, false, false)
            .await
    }

    /// Ingest a batch of [`MessageSample`] items with deduplication (used by both live WorkIQ polling and tests).
    pub async fn ingest_samples(
        &self,
        samples: Vec<MessageSample>,
        use_luna: bool,
    ) -> Result<ScanBatchResult, String> {
        self.ingest_samples_with_animation(samples, use_luna, true)
            .await
    }

    async fn ingest_samples_with_animation(
        &self,
        samples: Vec<MessageSample>,
        use_luna: bool,
        trigger_animation: bool,
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

        let mut reports = Vec::with_capacity(new_samples.len());
        let mut grenades_triggered = 0;

        for sample in &new_samples {
            let (report, _) = self
                .analyze_and_dispatch(sample, use_luna, true, trigger_animation)
                .await;
            if trigger_animation && report.is_slop_grenade {
                grenades_triggered += 1;
            }
            reports.push(report);
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
            let mut ticker = tokio::time::interval(Duration::from_secs(poll_interval_secs.max(5)));
            loop {
                ticker.tick().await;
                let _ = self.poll_workiq_once(false).await;
            }
        });
    }
}

pub use slop_grenade_core::presets::build_preset_sample;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slop_detector::AnimationTier;

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
        let batch = daemon
            .ingest_samples_with_animation(vec![existing.clone(), historical.clone()], false, false)
            .await
            .unwrap();
        assert_eq!(batch.new_messages_analyzed, 1);
        assert_eq!(batch.grenades_triggered, 0);
        assert_eq!(bus.recent_events().len(), 1);
        assert_eq!(ledger.scorecard().received_by_me.total_messages, 2);
        let again = daemon
            .ingest_samples_with_animation(vec![existing, historical], false, false)
            .await
            .unwrap();
        assert_eq!(again.new_messages_analyzed, 0);
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
}
