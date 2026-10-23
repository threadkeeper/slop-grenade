//! Privacy-preserving Self-Awareness Ledger tracking Sent vs. Received AI Slop.
//!
//! The core mission of Slop Grenade is making people aware of AI slop and Slop
//! Grenades—especially in **their own outgoing communications**. This ledger
//! aggregates separate statistics for messages **Sent by Me** vs. **Received by
//! Me** without persisting raw personal conversations to disk.

use std::collections::{BTreeMap, VecDeque};
use std::sync::Mutex;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::slop_detector::{
    AnimationTier, M365App, MessageDirection, MessageSample, SlopDetector, SlopReport,
};

/// Older reports retained in addition to the complete seven-day refresh window.
const MAX_OLDER_HISTORY_REPORTS: usize = 360;

/// Leaderboard entry for Top 5 Sloppers and Top 5 P-Doomers (refuse to use AI).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonLeaderboardEntry {
    /// Sender display name.
    pub name: String,
    /// Total messages observed for this sender.
    pub message_count: usize,
    /// Average AI slop score (`0..=100`).
    pub average_slop_score: u8,
    /// Total Slop Grenades (`score >= 80`) thrown by this sender.
    pub slop_grenades: usize,
    /// Total pure human-typed messages (`score < 20`).
    pub human_messages: usize,
}

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
    /// Daily outgoing metrics (resetting at midnight daily).
    pub daily_sent: DirectionalStats,
    /// Daily incoming metrics (resetting at midnight daily).
    pub daily_received: DirectionalStats,
    /// Top 5 Sloppers (highest average slop score / grenades thrown).
    pub top_sloppers: Vec<PersonLeaderboardEntry>,
    /// Top 5 P-Doomers (refuse to use AI — lowest average slop score & pure human typing).
    pub top_p_doomers: Vec<PersonLeaderboardEntry>,
    /// Dynamic self-awareness reflection comparing user's own habits against incoming messages.
    pub self_awareness_verdict: String,
    /// Most recent analyzed reports (newest first).
    pub recent_reports: Vec<SlopReport>,
}

#[derive(Default)]
struct LedgerInner {
    active_day_key: String,
    daily_sent_sum: u64,
    daily_received_sum: u64,
    daily_sent: DirectionalStats,
    daily_received: DirectionalStats,
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
        let report_day = extract_day_key(&report.timestamp);
        if !report_day.is_empty()
            && inner.active_day_key != report_day
            && (inner.active_day_key.is_empty() || report_day > inner.active_day_key)
        {
            inner.active_day_key = report_day.clone();
            inner.daily_sent = DirectionalStats::default();
            inner.daily_received = DirectionalStats::default();
            inner.daily_sent_sum = 0;
            inner.daily_received_sum = 0;
        }

        // Update all-time directional stats
        let (stats, sum) = match report.direction {
            MessageDirection::Sent => (&mut inner.sent, &mut inner.sent_sum),
            MessageDirection::Received => (&mut inner.received, &mut inner.received_sum),
        };
        apply_report_to_stats(stats, sum, &report);

        // Update today's midnight-resetting stats if this report belongs to the active day
        if report_day == inner.active_day_key {
            let (d_stats, d_sum) = match report.direction {
                MessageDirection::Sent => (&mut inner.daily_sent, &mut inner.daily_sent_sum),
                MessageDirection::Received => {
                    (&mut inner.daily_received, &mut inner.daily_received_sum)
                }
            };
            apply_report_to_stats(d_stats, d_sum, &report);
        }

        inner.recent.push_front(report);
        let cutoff_day = (Utc::now() - Duration::days(7))
            .format("%Y-%m-%d")
            .to_string();
        let mut older_count = 0;
        inner.recent.retain(|report| {
            // Keep the full UTC day covering the rolling seven-day boundary.
            if report
                .timestamp
                .get(..10)
                .is_some_and(|day| day >= cutoff_day.as_str())
            {
                true
            } else {
                older_count += 1;
                older_count <= MAX_OLDER_HISTORY_REPORTS
            }
        });
    }

    /// Seed baseline multi-day M365 history so time-span charts (`Today`, `7d`, `30d`) and
    /// the Top 5 Sloppers / Top 5 P-Doomers leaderboards are immediately populated.
    pub fn seed_baseline_history(&self) {
        let detector = SlopDetector::new();
        let samples = baseline_seed_samples();
        for sample in samples {
            let report = detector.analyze(&sample);
            self.record(report);
        }
    }

    /// Snapshot the current [`AwarenessScorecard`].
    pub fn scorecard(&self) -> AwarenessScorecard {
        let Ok(guard) = self.inner.lock() else {
            return AwarenessScorecard {
                sent_by_me: DirectionalStats::default(),
                received_by_me: DirectionalStats::default(),
                daily_sent: DirectionalStats::default(),
                daily_received: DirectionalStats::default(),
                top_sloppers: Vec::new(),
                top_p_doomers: Vec::new(),
                self_awareness_verdict: "Ledger unavailable".to_string(),
                recent_reports: Vec::new(),
            };
        };

        let mut recent_vec: Vec<SlopReport> = guard.recent.iter().cloned().collect();
        recent_vec.sort_by_cached_key(|report| {
            std::cmp::Reverse(DateTime::parse_from_rfc3339(&report.timestamp).ok())
        });
        let (top_sloppers, top_p_doomers) = compute_leaderboards(&recent_vec);
        let verdict = build_verdict(&guard.sent, &guard.received);
        AwarenessScorecard {
            sent_by_me: guard.sent.clone(),
            received_by_me: guard.received.clone(),
            daily_sent: guard.daily_sent.clone(),
            daily_received: guard.daily_received.clone(),
            top_sloppers,
            top_p_doomers,
            self_awareness_verdict: verdict,
            recent_reports: recent_vec,
        }
    }
}

fn apply_report_to_stats(stats: &mut DirectionalStats, sum: &mut u64, report: &SlopReport) {
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
}

fn extract_day_key(timestamp: &str) -> String {
    timestamp.chars().take(10).collect()
}

fn compute_leaderboards(
    reports: &[SlopReport],
) -> (Vec<PersonLeaderboardEntry>, Vec<PersonLeaderboardEntry>) {
    #[derive(Default)]
    struct Acc {
        count: usize,
        sum: u64,
        grenades: usize,
        human: usize,
    }

    let mut by_sender: BTreeMap<String, Acc> = BTreeMap::new();
    for r in reports {
        let name = r.sender.trim();
        if name.is_empty() {
            continue;
        }
        let entry = by_sender.entry(name.to_string()).or_default();
        entry.count += 1;
        entry.sum += u64::from(r.slop_score);
        if r.tier == AnimationTier::SlopGrenade {
            entry.grenades += 1;
        }
        if r.tier == AnimationTier::HumanSparkle {
            entry.human += 1;
        }
    }

    let all_entries: Vec<PersonLeaderboardEntry> = by_sender
        .into_iter()
        .map(|(name, acc)| PersonLeaderboardEntry {
            name,
            message_count: acc.count,
            average_slop_score: (acc.sum / (acc.count.max(1) as u64)).min(100) as u8,
            slop_grenades: acc.grenades,
            human_messages: acc.human,
        })
        .collect();

    // Top 5 Sloppers: highest average slop score ( >= 45 ), tie-broken by grenade count & message count
    let mut sloppers: Vec<PersonLeaderboardEntry> = all_entries
        .iter()
        .filter(|e| e.average_slop_score >= 45)
        .cloned()
        .collect();
    sloppers.sort_by(|a, b| {
        b.average_slop_score
            .cmp(&a.average_slop_score)
            .then_with(|| b.slop_grenades.cmp(&a.slop_grenades))
            .then_with(|| b.message_count.cmp(&a.message_count))
    });
    sloppers.truncate(5);

    // Top 5 P-Doomers (refuse to use AI): lowest average slop score (< 35), tie-broken by human message count
    let mut p_doomers: Vec<PersonLeaderboardEntry> = all_entries
        .into_iter()
        .filter(|e| e.average_slop_score < 35)
        .collect();
    p_doomers.sort_by(|a, b| {
        a.average_slop_score
            .cmp(&b.average_slop_score)
            .then_with(|| b.human_messages.cmp(&a.human_messages))
            .then_with(|| b.message_count.cmp(&a.message_count))
    });
    p_doomers.truncate(5);

    (sloppers, p_doomers)
}

fn baseline_seed_samples() -> Vec<MessageSample> {
    let grenade_body = "I hope this message finds you thriving! Quick first pass from Copilot for reaction:\n- **Strategic Alignment:** Fostering holistic cross-functional synergy across all pivotal workstreams.\n- **Transformative Paradigm:** Delving into the multifaceted tapestry of our evolving landscape.\n- **Actionable Insights:** Leveraging seamless architectures to catalyze our north star.";
    let splat_body = "I hope this email finds you well. In today's fast-paced evolving landscape, it is important to note that fostering cross-functional strategic alignment is pivotal. Furthermore, we must delve into holistic actionable insights to streamline our paradigm.";
    let fruit_body = "I hope this email finds you well. Thank you for reaching out about the Q4 milestones. Furthermore, we want to ensure a seamless handoff and unlock value for the squad next week.";
    let cloud_body = "Hi everyone, I hope your week is going well. Additionally, I uploaded the benchmark numbers to the shared folder before Monday's sync.";
    let human_body =
        "Fixed the null pointer in the auth retry loop—PR #142 is ready for a quick look.";

    let rows: &[(&str, M365App, MessageDirection, &str, &str, &str)] = &[
        // Historical 30-day & 7-day entries
        (
            "seed-01",
            M365App::Outlook,
            MessageDirection::Received,
            "Chadwick Sterling",
            grenade_body,
            "2026-09-28T09:15:00Z",
        ),
        (
            "seed-02",
            M365App::Teams,
            MessageDirection::Received,
            "Bryce Kensington",
            grenade_body,
            "2026-10-02T11:20:00Z",
        ),
        (
            "seed-03",
            M365App::Outlook,
            MessageDirection::Received,
            "Kendall Vance",
            splat_body,
            "2026-10-06T14:10:00Z",
        ),
        (
            "seed-04",
            M365App::Teams,
            MessageDirection::Sent,
            "You",
            fruit_body,
            "2026-10-09T16:05:00Z",
        ),
        (
            "seed-05",
            M365App::Teams,
            MessageDirection::Received,
            "Linus Stallman",
            human_body,
            "2026-10-12T10:00:00Z",
        ),
        (
            "seed-06",
            M365App::Outlook,
            MessageDirection::Received,
            "Ada K. (vim-only)",
            "No LLM needed. Read the stack trace on line 44 and revert the mutex lock.",
            "2026-10-14T15:30:00Z",
        ),
        (
            "seed-07",
            M365App::Teams,
            MessageDirection::Received,
            "Chadwick Sterling",
            grenade_body,
            "2026-10-17T09:40:00Z",
        ),
        (
            "seed-08",
            M365App::Outlook,
            MessageDirection::Sent,
            "You",
            cloud_body,
            "2026-10-18T11:10:00Z",
        ),
        (
            "seed-09",
            M365App::Teams,
            MessageDirection::Received,
            "Devon Vance",
            splat_body,
            "2026-10-19T13:45:00Z",
        ),
        (
            "seed-10",
            M365App::Teams,
            MessageDirection::Received,
            "Greg Kroah",
            "Acked-by: Greg. Patch applies cleanly on main.",
            "2026-10-20T08:50:00Z",
        ),
        (
            "seed-11",
            M365App::Outlook,
            MessageDirection::Received,
            "Sloane Mercer",
            grenade_body,
            "2026-10-21T10:15:00Z",
        ),
        (
            "seed-12",
            M365App::Teams,
            MessageDirection::Sent,
            "You",
            human_body,
            "2026-10-21T16:20:00Z",
        ),
        (
            "seed-13",
            M365App::Teams,
            MessageDirection::Received,
            "Elena Rostova",
            "Shipped the SQL migration script. Zero downtime on staging.",
            "2026-10-22T09:30:00Z",
        ),
        (
            "seed-14",
            M365App::Outlook,
            MessageDirection::Received,
            "Bryce Kensington",
            grenade_body,
            "2026-10-22T14:00:00Z",
        ),
        (
            "seed-15",
            M365App::Teams,
            MessageDirection::Received,
            "Marcus Aurelius",
            "Write less. Think more. See you in standup at 09:00.",
            "2026-10-22T17:15:00Z",
        ),
        // Today's entries (2026-10-23)
        (
            "seed-16",
            M365App::Teams,
            MessageDirection::Received,
            "Chadwick Sterling",
            grenade_body,
            "2026-10-23T08:30:00Z",
        ),
        (
            "seed-17",
            M365App::Outlook,
            MessageDirection::Received,
            "Kendall Vance",
            splat_body,
            "2026-10-23T09:45:00Z",
        ),
        (
            "seed-18",
            M365App::Teams,
            MessageDirection::Sent,
            "You",
            fruit_body,
            "2026-10-23T10:20:00Z",
        ),
        (
            "seed-19",
            M365App::Teams,
            MessageDirection::Received,
            "Linus Stallman",
            "Looks good to me. Merge it.",
            "2026-10-23T11:15:00Z",
        ),
        (
            "seed-20",
            M365App::Outlook,
            MessageDirection::Sent,
            "You",
            splat_body,
            "2026-10-23T13:10:00Z",
        ),
        (
            "seed-21",
            M365App::Teams,
            MessageDirection::Received,
            "Ada K. (vim-only)",
            "Tested on Windows 11 x64. Latency dropped from 18ms to 4ms.",
            "2026-10-23T14:05:00Z",
        ),
        (
            "seed-22",
            M365App::Outlook,
            MessageDirection::Received,
            "Sloane Mercer",
            grenade_body,
            "2026-10-23T15:20:00Z",
        ),
    ];

    rows.iter()
        .map(|&(id, app, direction, sender, body, ts)| MessageSample {
            message_id: id.to_string(),
            app,
            direction,
            sender: sender.to_string(),
            subject_or_topic: "Demo communication".to_string(),
            body: body.to_string(),
            timestamp: ts.to_string(),
        })
        .collect()
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
    use chrono::{Duration, SecondsFormat, Utc};

    #[test]
    fn retains_a_full_week_even_when_it_exceeds_the_old_report_cap() {
        let ledger = AwarenessLedger::new();
        let detector = SlopDetector::new();
        let now = Utc::now();
        for index in 0..420 {
            ledger.record(detector.analyze(&MessageSample {
                message_id: format!("week-{index}"),
                app: M365App::Outlook,
                direction: MessageDirection::Received,
                sender: "Fictional Colleague".to_string(),
                subject_or_topic: "Synthetic history".to_string(),
                body: "The fix is ready for review.".to_string(),
                timestamp:
                    (now - Duration::minutes(index)).to_rfc3339_opts(SecondsFormat::Millis, true),
            }));
        }
        let card = ledger.scorecard();
        assert_eq!(card.recent_reports.len(), 420);
        assert_eq!(card.received_by_me.total_messages, 420);
        assert!(card
            .recent_reports
            .windows(2)
            .all(|pair| pair[0].timestamp >= pair[1].timestamp));
    }

    #[test]
    fn older_history_remains_bounded_without_evicting_the_refreshed_week() {
        let ledger = AwarenessLedger::new();
        let detector = SlopDetector::new();
        let now = Utc::now();
        for index in 0..400 {
            for (prefix, age) in [("old", Duration::days(30)), ("week", Duration::zero())] {
                ledger.record(
                    detector.analyze(&MessageSample {
                        message_id: format!("{prefix}-{index}"),
                        app: M365App::Teams,
                        direction: MessageDirection::Received,
                        sender: "Fictional Colleague".to_string(),
                        subject_or_topic: "Synthetic retention fixture".to_string(),
                        body: "Ready for review.".to_string(),
                        timestamp: (now - age - Duration::minutes(index))
                            .to_rfc3339_opts(SecondsFormat::Millis, true),
                    }),
                );
            }
        }
        let card = ledger.scorecard();
        assert_eq!(card.received_by_me.total_messages, 800);
        assert_eq!(card.recent_reports.len(), 400 + MAX_OLDER_HISTORY_REPORTS);
        assert_eq!(
            card.recent_reports
                .iter()
                .filter(|report| report.message_id.starts_with("week-"))
                .count(),
            400
        );
    }

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
