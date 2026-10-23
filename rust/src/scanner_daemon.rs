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
use crate::slop_detector::{M365App, MessageDirection, MessageSample, SlopDetector, SlopReport};
use crate::workiq_mcp::WorkIqClient;

/// Summary of one M365 WorkIQ scan cycle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanBatchResult {
    /// Total messages returned by WorkIQ MCP in this poll.
    pub fetched_count: usize,
    /// Number of newly discovered (previously unseen) messages analyzed.
    pub new_messages_analyzed: usize,
    /// Number of Slop Grenades (`score >= 80`) triggered in this batch.
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

    /// Ingest a batch of [`MessageSample`] items with deduplication (used by both live WorkIQ polling and tests).
    pub async fn ingest_samples(
        &self,
        samples: Vec<MessageSample>,
        use_luna: bool,
    ) -> Result<ScanBatchResult, String> {
        let fetched_count = samples.len();
        let mut new_samples = Vec::new();

        if let Ok(mut guard) = self.seen_ids.lock() {
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
                .analyze_and_dispatch(sample, use_luna, true, true)
                .await;
            if report.is_slop_grenade {
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

/// Build a realistic preset [`MessageSample`] for any of the 5 animation tiers or outgoing self-check.
pub fn build_preset_sample(preset: &str, sequence_hint: u64) -> MessageSample {
    let id = format!("sim-{preset}-{sequence_hint}");
    match preset {
        "human_sparkle" => MessageSample {
            message_id: id,
            app: M365App::Teams,
            direction: MessageDirection::Received,
            sender: "Sarah Chen (Engineering)".to_string(),
            subject_or_topic: "PR #118 — Auth Token Cache".to_string(),
            body: "Hey! Just tested your branch locally—the WorkIQ stdio pipe reconnects cleanly now. LGTM, ship it whenever you're ready.".to_string(),
            timestamp: "2026-10-23T14:35:00Z".to_string(),
        },
        "peaceful_cloud" => MessageSample {
            message_id: id,
            app: M365App::Outlook,
            direction: MessageDirection::Received,
            sender: "David Patel".to_string(),
            subject_or_topic: "Friday Architecture Review Notes".to_string(),
            body: "Hi everyone, I hope your week is going well. Additionally, I have uploaded the slide deck from this morning's review so the team can check the latency numbers before Monday.".to_string(),
            timestamp: "2026-10-23T14:36:00Z".to_string(),
        },
        "innocent_fruit" => MessageSample {
            message_id: id,
            app: M365App::Outlook,
            direction: MessageDirection::Received,
            sender: "Priya Nair".to_string(),
            subject_or_topic: "Sprint 14 Planning Follow-up".to_string(),
            body: "I hope this email finds you well. Thank you for reaching out about the Q4 milestones. Furthermore, we want to ensure a seamless handoff and unlock value for the mobile squad next week.".to_string(),
            timestamp: "2026-10-23T14:37:00Z".to_string(),
        },
        "slop_splat" => MessageSample {
            message_id: id,
            app: M365App::Outlook,
            direction: MessageDirection::Received,
            sender: "Marcus Vance".to_string(),
            subject_or_topic: "Driving Cross-Functional Synergy in Q4".to_string(),
            body: "I hope this email finds you well. In today's fast-paced evolving landscape, it is important to note that fostering cross-functional strategic alignment is pivotal. Furthermore, we must delve into holistic actionable insights to streamline our paradigm.".to_string(),
            timestamp: "2026-10-23T14:38:00Z".to_string(),
        },
        "my_outgoing_grenade" => MessageSample {
            message_id: id,
            app: M365App::Teams,
            direction: MessageDirection::Sent,
            sender: "You (Self-Awareness Mirror)".to_string(),
            subject_or_topic: "Platform Strategy Thread".to_string(),
            body: "Certainly! Here is a polished draft for the team. I hope this message finds you well! Had Copilot take a pass for reaction:\n\
                   - **Strategic Alignment:** Fostering holistic cross-functional synergy across all pivotal workstreams.\n\
                   - **Transformative Paradigm:** Delving into the multifaceted tapestry of our evolving landscape.\n\
                   - **Actionable Insights:** Leveraging seamless, robust architectures to catalyze our north star.\n\
                   In conclusion, please do not hesitate to reach out!".to_string(),
            timestamp: "2026-10-23T14:39:00Z".to_string(),
        },
        _ => MessageSample {
            message_id: id,
            app: M365App::Teams,
            direction: MessageDirection::Received,
            sender: "Chad from Strategy".to_string(),
            subject_or_topic: "Quick Thoughts on Q4 Synergy".to_string(),
            body: "I hope this message finds you thriving! Quick first pass from AI for reaction as we delve into the evolving landscape:\n\n\
                   ### Key Takeaways\n\
                   - **Strategic Alignment:** Fostering holistic cross-functional synergy across all pivotal workstreams.\n\
                   - **Transformative Paradigm:** Leveraging seamless, robust architectures to catalyze actionable insights.\n\
                   - **Operational Excellence:** Streamlining our multifaceted roadmap—not only for speed, but also for scale.\n\
                   - **Next Steps:** Please do not hesitate to reach out as we spearhead this beacon of innovation.\n\n\
                   In conclusion, it is important to note that this comprehensive overview underscores our north star.".to_string(),
            timestamp: "2026-10-23T14:40:00Z".to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slop_detector::AnimationTier;

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
