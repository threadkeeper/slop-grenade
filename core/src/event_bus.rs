//! Real-time animation event bus for broadcasting monitor overlay triggers.
//!
//! Every analyzed M365 message (or manual simulation) publishes an
//! [`AnimationEvent`] onto [`AnimationEventBus`], which fans out over
//! Server-Sent Events (`GET /api/v1/events/stream`) to all connected monitor
//! overlays and dashboard tabs.

use std::collections::VecDeque;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::slop_detector::{MonitorSide, SlopReport};

/// Maximum number of recent animation events buffered for late-joining overlay windows.
const RECENT_EVENT_CAPACITY: usize = 32;

/// Single animation trigger event delivered to the monitor overlay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationEvent {
    /// Monotonically increasing sequence number for client deduplication.
    pub sequence: u64,
    /// Communication reset epoch; clients must discard events from older epochs.
    #[serde(default)]
    pub reset_generation: u64,
    /// Slop analysis report that triggered this animation.
    pub report: SlopReport,
    /// Optional squeegee wipe trigger (`Some(MonitorSide)` when wiping a monitor edge).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub squeegee_side: Option<MonitorSide>,
    /// Whether every client must erase communication-derived display and deduplication state.
    #[serde(default, skip_serializing_if = "is_false")]
    pub data_wiped: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// Broadcast bus for real-time monitor animations.
pub struct AnimationEventBus {
    sender: broadcast::Sender<AnimationEvent>,
    state: Mutex<BusState>,
}

struct BusState {
    next_seq: u64,
    reset_generation: u64,
    recent: VecDeque<AnimationEvent>,
    latest_wipe: Option<AnimationEvent>,
}

impl Default for AnimationEventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl AnimationEventBus {
    /// Create a new [`AnimationEventBus`].
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(128);
        Self {
            sender,
            state: Mutex::new(BusState {
                next_seq: 1,
                reset_generation: 0,
                recent: VecDeque::with_capacity(RECENT_EVENT_CAPACITY),
                latest_wipe: None,
            }),
        }
    }

    /// Publish a [`SlopReport`] as an [`AnimationEvent`] to all live subscribers.
    pub fn publish(&self, report: SlopReport) -> AnimationEvent {
        self.publish_event(report, None, false, true)
    }

    /// Broadcast a squeegee wipe command for `side` (`Left` or `Right`) to all connected desktop & web overlays.
    pub fn publish_squeegee(
        &self,
        side: MonitorSide,
        placeholder_report: SlopReport,
    ) -> AnimationEvent {
        self.publish_event(placeholder_report, Some(side), false, false)
    }

    fn publish_event(
        &self,
        report: SlopReport,
        squeegee_side: Option<MonitorSide>,
        data_wiped: bool,
        buffered: bool,
    ) -> AnimationEvent {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if data_wiped {
            state.reset_generation = state.reset_generation.saturating_add(1);
            state.recent.clear();
        }
        let event = AnimationEvent {
            sequence: state.next_seq,
            reset_generation: state.reset_generation,
            report,
            squeegee_side,
            data_wiped,
        };
        state.next_seq = state.next_seq.saturating_add(1);
        if data_wiped {
            state.latest_wipe = Some(event.clone());
        } else if buffered {
            if state.recent.len() >= RECENT_EVENT_CAPACITY {
                state.recent.pop_front();
            }
            state.recent.push_back(event.clone());
        }
        // Keep publication ordered with the durable marker and subscription snapshot.
        let _ = self.sender.send(event.clone());
        event
    }

    /// Subscribe to live [`AnimationEvent`] broadcasts.
    pub fn subscribe(&self) -> broadcast::Receiver<AnimationEvent> {
        self.sender.subscribe()
    }

    /// Atomically subscribe and snapshot the latest durable reset marker.
    ///
    /// A concurrent wipe is either in the snapshot or the receiver (possibly both),
    /// so consumers deduplicate by sequence and cannot miss the reset window.
    pub fn subscribe_with_reset(
        &self,
    ) -> (broadcast::Receiver<AnimationEvent>, Option<AnimationEvent>) {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        (self.sender.subscribe(), state.latest_wipe.clone())
    }

    /// Latest reset marker, retained independently of the bounded animation queue.
    pub fn latest_data_wipe(&self) -> Option<AnimationEvent> {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .latest_wipe
            .clone()
    }

    /// Return the most recent buffered [`AnimationEvent`] items.
    pub fn recent_events(&self) -> Vec<AnimationEvent> {
        self.state
            .lock()
            .map(|state| state.recent.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Poll up to 32 ordinary events plus any newer durable reset marker.
    pub fn events_after(&self, after: u64) -> Vec<AnimationEvent> {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state
            .latest_wipe
            .iter()
            .chain(state.recent.iter())
            .filter(|event| event.sequence > after)
            .cloned()
            .collect()
    }

    /// Publish and buffer a wipe for polling clients; desktop wipes remain live-only.
    pub fn publish_squeegee_buffered(
        &self,
        side: MonitorSide,
        placeholder_report: SlopReport,
    ) -> AnimationEvent {
        self.publish_event(placeholder_report, Some(side), false, true)
    }

    /// Forget retained events whose IDs start with the exact `account_id:` prefix.
    ///
    /// Already delivered live broadcasts cannot be recalled.
    pub fn remove_account(&self, account_id: &str) {
        let prefix = format!("{account_id}:");
        if let Ok(mut state) = self.state.lock() {
            state
                .recent
                .retain(|event| !event.report.message_id.starts_with(&prefix));
        }
    }

    /// Erase retained communication events, returning the event count removed.
    pub fn clear(&self) -> Result<usize, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Animation event wipe is unavailable.".to_string())?;
        let removed = state.recent.len();
        state.recent.clear();
        Ok(removed)
    }

    /// Notify clients of a reset and retain its marker independently of animations.
    pub fn publish_data_wipe(&self, placeholder_report: SlopReport) -> AnimationEvent {
        self.publish_event(placeholder_report, None, true, false)
    }

    /// Publish and retain a data-wipe notification for polling clients.
    pub fn publish_data_wipe_buffered(&self, placeholder_report: SlopReport) -> AnimationEvent {
        self.publish_data_wipe(placeholder_report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slop_detector::{M365App, MessageDirection, MessageSample, SlopDetector};

    #[test]
    fn polling_is_bounded_repeatable_and_filters_strictly_after_cursor() {
        let bus = AnimationEventBus::new();
        let report =
            SlopDetector::new().analyze(&crate::presets::build_preset_sample("human_sparkle", 1));
        for _ in 0..40 {
            bus.publish(report.clone());
        }
        assert_eq!(bus.events_after(0).len(), 32);
        assert_eq!(bus.events_after(0)[0].sequence, 9);
        assert_eq!(bus.events_after(38).len(), 2);
        assert_eq!(bus.events_after(38), bus.events_after(38));
        assert!(bus.events_after(40).is_empty());
        assert!(bus.events_after(u64::MAX).is_empty());
    }

    #[test]
    fn mobile_wipes_are_buffered_but_desktop_wipes_keep_existing_behavior() {
        let bus = AnimationEventBus::new();
        let report =
            SlopDetector::new().analyze(&crate::presets::build_preset_sample("human_sparkle", 1));
        bus.publish_squeegee(MonitorSide::Left, report.clone());
        assert!(bus.recent_events().is_empty());
        let event = bus.publish_squeegee_buffered(MonitorSide::Right, report);
        assert_eq!(bus.events_after(0), vec![event]);
    }

    #[test]
    fn disconnect_removes_only_exact_account_prefix_events() {
        let bus = AnimationEventBus::new();
        for id in ["a:1", "ab:1", "b:1"] {
            let mut sample = crate::presets::build_preset_sample("human_sparkle", 1);
            sample.message_id = id.into();
            bus.publish(SlopDetector::new().analyze(&sample));
        }
        bus.remove_account("a");
        assert_eq!(bus.events_after(0).len(), 2);
        assert_eq!(bus.events_after(0)[0].report.message_id, "ab:1");
    }

    #[test]
    fn clear_erases_ordinary_events_and_preserves_a_durable_reset_marker() {
        let bus = AnimationEventBus::new();
        let report =
            SlopDetector::new().analyze(&crate::presets::build_preset_sample("human_sparkle", 1));
        bus.publish(report.clone());
        assert_eq!(bus.clear(), Ok(1));
        assert!(bus.recent_events().is_empty());

        let event = bus.publish_data_wipe(report);
        assert!(event.data_wiped);
        assert_eq!(event.reset_generation, 1);
        assert!(bus.recent_events().is_empty());
        assert_eq!(bus.events_after(0), vec![event.clone()]);
        assert_eq!(bus.latest_data_wipe(), Some(event.clone()));
        assert_eq!(bus.clear(), Ok(0));
        assert_eq!(bus.events_after(0), vec![event]);
    }

    #[test]
    fn reset_marker_survives_queue_overflow_and_advances_monotonically() {
        let bus = AnimationEventBus::new();
        let report =
            SlopDetector::new().analyze(&crate::presets::build_preset_sample("human_sparkle", 1));
        let wipe = bus.publish_data_wipe_buffered(report.clone());
        for _ in 0..64 {
            assert_eq!(bus.publish(report.clone()).reset_generation, 1);
        }
        let polled = bus.events_after(0);
        assert_eq!(polled.len(), 33);
        assert_eq!(polled[0], wipe);
        assert_eq!(bus.events_after(wipe.sequence).len(), 32);
        let second = bus.publish_data_wipe(report);
        assert_eq!(second.reset_generation, 2);
        assert_eq!(bus.events_after(0), vec![second]);
    }

    #[test]
    fn subscribing_concurrently_with_reset_never_misses_its_marker() {
        for _ in 0..64 {
            let bus = std::sync::Arc::new(AnimationEventBus::new());
            let publishing = bus.clone();
            let thread = std::thread::spawn(move || {
                publishing.publish_data_wipe(
                    SlopDetector::new()
                        .analyze(&crate::presets::build_preset_sample("human_sparkle", 0)),
                )
            });
            let (mut receiver, snapshot) = bus.subscribe_with_reset();
            let wipe = thread.join().unwrap();
            assert_eq!(snapshot.or_else(|| receiver.try_recv().ok()), Some(wipe));
        }
    }

    #[tokio::test]
    async fn publishes_incrementing_sequence_and_notifies_subscriber() {
        let bus = AnimationEventBus::new();
        let mut rx = bus.subscribe();
        let detector = SlopDetector::new();

        let report = detector.analyze(&MessageSample {
            message_id: "m-1".to_string(),
            app: M365App::Teams,
            direction: MessageDirection::Received,
            sender: "Sam".to_string(),
            subject_or_topic: "Quick sync".to_string(),
            body: "Sounds good, see you at 10.".to_string(),
            timestamp: "2026-10-23T10:00:00Z".to_string(),
        });

        let emitted = bus.publish(report);
        assert_eq!(emitted.sequence, 1);

        let received = rx.recv().await.unwrap();
        assert_eq!(received.sequence, 1);
        assert_eq!(bus.recent_events().len(), 1);
    }
}
