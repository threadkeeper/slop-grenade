//! Privacy-preserving Self-Awareness Ledger tracking Sent vs. Received AI Slop.
//!
//! The core mission of Slop Grenade is making people aware of AI slop and Slop
//! Grenades—especially in **their own outgoing communications**. This ledger
//! aggregates separate statistics for messages **Sent by Me** vs. **Received by
//! Me** without persisting raw personal conversations to disk.

use std::collections::VecDeque;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::slop_detector::{AnimationTier, MessageDirection, SlopReport};

/// Maximum number of sanitized reports kept in memory for the dashboard feed.
const MAX_HISTORY_REPORTS: usize = 60;

/// Aggregated statistics for one communication direction (`Sent` or `Received`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectionalStats {
    /// Total messages analyzed in this direction.
    pub total_messages: usize,
    /// Average slop score (`0..=100`) across all messages in this direction.
    pub average_slop_score: u8,
    /// Count of `HumanSparkle` (`0..=19`) messages.
    pub human_sparkles: usize,
    /// Count of `PeacefulCloud` (`20..=39`) messages.
    pub peaceful_clouds: usize,
    /// Count of `InnocentFruit` (`40..=59`) messages.
    pub innocent_fruits: usize,
    /// Count of `SlopSplat` (`60..=79`) messages.
    pub slop_splats: usize,
    /// Count of `SlopGrenade` (`80..=100`) messages.
    pub slop_grenades: usize,
    /// Consecutive messages in this direction that stayed below 40 (`HumanSparkle` or `PeacefulCloud`).
    pub clean_human_streak: usize,
}

/// Complete self-awareness scorecard and recent activity feed returned by `GET /api/v1/ledger`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwarenessScorecard {
    /// Metrics for communications authored/sent by the user ("My Outgoing Footprint").
    pub sent_by_me: DirectionalStats,
    /// Metrics for communications received from colleagues ("Incoming Workplace Weather").
    pub received_by_me: DirectionalStats,
    /// Dynamic self-awareness reflection comparing user's own habits against incoming messages.
    pub self_awareness_verdict: String,
    /// Most recent analyzed reports (newest first).
    pub recent_reports: Vec<SlopReport>,
}

#[derive(Default)]
struct LedgerInner {
    sent_sum: u64,
    received_sum: u64,
    sent: DirectionalStats,
    received: DirectionalStats,
    recent: VecDeque<SlopReport>,
}

/// Thread-safe in-memory ledger of sent and received communication quality.
#[derive(Default)]
pub struct AwarenessLedger {
    inner: Mutex<LedgerInner>,
}

impl AwarenessLedger {
    /// Create an empty [`AwarenessLedger`].
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a completed [`SlopReport`] and update directional counters.
    pub fn record(&self, report: SlopReport) {
        let Ok(mut guard) = self.inner.lock() else {
            return;
        };

        let inner = &mut *guard;
        let (stats, sum) = match report.direction {
            MessageDirection::Sent => (&mut inner.sent, &mut inner.sent_sum),
            MessageDirection::Received => (&mut inner.received, &mut inner.received_sum),
        };

        stats.total_messages += 1;
        *sum += u64::from(report.slop_score);
        stats.average_slop_score = (*sum / (stats.total_messages as u64)).min(100) as u8;

        match report.tier {
            AnimationTier::HumanSparkle => stats.human_sparkles += 1,
            AnimationTier::PeacefulCloud => stats.peaceful_clouds += 1,
            AnimationTier::InnocentFruit => stats.innocent_fruits += 1,
            AnimationTier::SlopSplat => stats.slop_splats += 1,
            AnimationTier::SlopGrenade => stats.slop_grenades += 1,
        }

        if report.slop_score < 40 {
            stats.clean_human_streak += 1;
        } else {
            stats.clean_human_streak = 0;
        }

        if guard.recent.len() >= MAX_HISTORY_REPORTS {
            guard.recent.pop_back();
        }
        guard.recent.push_front(report);
    }

    /// Snapshot the current [`AwarenessScorecard`].
    pub fn scorecard(&self) -> AwarenessScorecard {
        let Ok(guard) = self.inner.lock() else {
            return AwarenessScorecard {
                sent_by_me: DirectionalStats::default(),
                received_by_me: DirectionalStats::default(),
                self_awareness_verdict: "Ledger unavailable".to_string(),
                recent_reports: Vec::new(),
            };
        };

        let verdict = build_verdict(&guard.sent, &guard.received);
        AwarenessScorecard {
            sent_by_me: guard.sent.clone(),
            received_by_me: guard.received.clone(),
            self_awareness_verdict: verdict,
            recent_reports: guard.recent.iter().cloned().collect(),
        }
    }
}

fn build_verdict(sent: &DirectionalStats, received: &DirectionalStats) -> String {
    if sent.total_messages == 0 && received.total_messages == 0 {
        return "No M365 messages scanned yet. Trigger a scan or test a sample message to see your Slop Scorecard!".to_string();
    }
    if sent.slop_grenades > 0 {
        return format!(
            "Self-Awareness Check: You have thrown {} Slop Grenade(s) (avg outgoing slop: {}/100). Try stripping `- **Bold:**` bullet walls and stating your ask in 2 plain human sentences!",
            sent.slop_grenades, sent.average_slop_score
        );
    }
    if sent.total_messages > 0 && sent.average_slop_score <= 25 {
        return format!(
            "Exemplary Human Communicator! Your outgoing average is {}/100 with a {}-message clean human streak (while surviving {} incoming Slop Grenade(s)).",
            sent.average_slop_score, sent.clean_human_streak, received.slop_grenades
        );
    }
    if sent.total_messages > 0 {
        return format!(
            "Your outgoing slop average is {}/100 ({} sent) vs. {}/100 incoming ({} received, {} grenades).",
            sent.average_slop_score,
            sent.total_messages,
            received.average_slop_score,
            received.total_messages,
            received.slop_grenades
        );
    }
    format!(
        "Scanned {} incoming M365 message(s) (avg {}/100, {} Slop Grenades). Send or test an outgoing message to measure your own footprint!",
        received.total_messages, received.average_slop_score, received.slop_grenades
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slop_detector::{M365App, MessageSample, SlopDetector};

    #[test]
    fn tracks_sent_and_received_stats_and_streaks_independently() {
        let ledger = AwarenessLedger::new();
        let detector = SlopDetector::new();

        // 1. User sends a clean human message -> streak = 1
        let r1 = detector.analyze(&MessageSample {
            message_id: "s1".to_string(),
            app: M365App::Teams,
            direction: MessageDirection::Sent,
            sender: "Me".to_string(),
            subject_or_topic: "Chat".to_string(),
            body: "Merged the fix, thanks!".to_string(),
            timestamp: "2026-10-23T10:00:00Z".to_string(),
        });
        ledger.record(r1);

        // 2. Colleague throws a Slop Grenade -> received.slop_grenades = 1, user's sent streak unaffected!
        let r2 = detector.analyze(&MessageSample {
            message_id: "r1".to_string(),
            app: M365App::Teams,
            direction: MessageDirection::Received,
            sender: "Colleague".to_string(),
            subject_or_topic: "Chat".to_string(),
            body: "I hope this message finds you well! Quick first pass from Copilot:\n- **Synergy:** Delving into the evolving landscape.\n- **Key Takeaways:** Fostering holistic paradigm alignment.\n- **Actionable Insights:** Streamlining our north star.".to_string(),
            timestamp: "2026-10-23T10:01:00Z".to_string(),
        });
        ledger.record(r2);

        let card = ledger.scorecard();
        assert_eq!(card.sent_by_me.total_messages, 1);
        assert_eq!(card.sent_by_me.human_sparkles, 1);
        assert_eq!(card.sent_by_me.clean_human_streak, 1);
        assert_eq!(card.sent_by_me.slop_grenades, 0);

        assert_eq!(card.received_by_me.total_messages, 1);
        assert_eq!(card.received_by_me.slop_grenades, 1);
        assert!(card
            .self_awareness_verdict
            .contains("Exemplary Human Communicator"));
    }
}
