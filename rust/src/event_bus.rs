//! Real-time animation event bus for broadcasting monitor overlay triggers.
//!
//! Every analyzed M365 message (or manual simulation) publishes an
//! [`AnimationEvent`] onto [`AnimationEventBus`], which fans out over
//! Server-Sent Events (`GET /api/v1/events/stream`) to all connected monitor
//! overlays and dashboard tabs.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
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
    /// Slop analysis report that triggered this animation.
    pub report: SlopReport,
    /// Optional squeegee wipe trigger (`Some(MonitorSide)` when wiping a monitor edge).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub squeegee_side: Option<MonitorSide>,
}

/// Broadcast bus for real-time monitor animations.
pub struct AnimationEventBus {
    next_seq: AtomicU64,
    sender: broadcast::Sender<AnimationEvent>,
    recent: Mutex<VecDeque<AnimationEvent>>,
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
            next_seq: AtomicU64::new(1),
            sender,
            recent: Mutex::new(VecDeque::with_capacity(RECENT_EVENT_CAPACITY)),
        }
    }

    /// Publish a [`SlopReport`] as an [`AnimationEvent`] to all live subscribers.
    pub fn publish(&self, report: SlopReport) -> AnimationEvent {
        let sequence = self.next_seq.fetch_add(1, Ordering::SeqCst);
        let event = AnimationEvent {
            sequence,
            report,
            squeegee_side: None,
        };
        if let Ok(mut guard) = self.recent.lock() {
            if guard.len() >= RECENT_EVENT_CAPACITY {
                guard.pop_front();
            }
            guard.push_back(event.clone());
        }
        let _ = self.sender.send(event.clone());
        event
    }

    /// Broadcast a squeegee wipe command for `side` (`Left` or `Right`) to all connected desktop & web overlays.
    pub fn publish_squeegee(
        &self,
        side: MonitorSide,
        placeholder_report: SlopReport,
    ) -> AnimationEvent {
        let sequence = self.next_seq.fetch_add(1, Ordering::SeqCst);
        let event = AnimationEvent {
            sequence,
            report: placeholder_report,
            squeegee_side: Some(side),
        };
        let _ = self.sender.send(event.clone());
        event
    }

    /// Subscribe to live [`AnimationEvent`] broadcasts.
    pub fn subscribe(&self) -> broadcast::Receiver<AnimationEvent> {
        self.sender.subscribe()
    }

    /// Return the most recent buffered [`AnimationEvent`] items.
    pub fn recent_events(&self) -> Vec<AnimationEvent> {
        self.recent
            .lock()
            .map(|g| g.iter().cloned().collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slop_detector::{M365App, MessageDirection, MessageSample, SlopDetector};

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
