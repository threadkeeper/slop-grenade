//! Metadata-only live history counters; never stores messages or account identities.

use serde::Serialize;

use crate::refresh_phase::RefreshPhase;

/// Snapshot of a history refresh, safe to poll independently of animation events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshProgress {
    /// Opaque caller-generated correlation ID, absent for older clients.
    pub refresh_id: Option<String>,
    /// Requested history window in days.
    pub lookback_days: u8,
    /// Current fetch or analysis stage.
    pub phase: RefreshPhase,
    /// Outlook records examined across completed pages.
    pub outlook_scanned: usize,
    /// Outlook total when reported reliably or established by the last page.
    pub outlook_total: Option<usize>,
    /// Teams message records examined across completed pages.
    pub teams_scanned: usize,
    /// Teams total once every remaining chat's size is known.
    pub teams_total: Option<usize>,
    /// Chats discovered while the chat list is being paged.
    pub teams_chats_discovered: usize,
    /// Chats whose message pages have all been examined.
    pub teams_chats_scanned: usize,
    /// Total distinct active chats once discovery has finished.
    pub teams_chats_total: Option<usize>,
    /// Newly discovered messages scored so far.
    pub analyzed_count: usize,
    /// Number of new messages left after deduplication, once analysis begins.
    pub analysis_total: Option<usize>,
}

impl RefreshProgress {
    /// Begin an empty progress snapshot without inventing provider totals.
    pub fn new(lookback_days: u8, refresh_id: Option<String>) -> Self {
        Self {
            refresh_id,
            lookback_days,
            phase: RefreshPhase::Connecting,
            outlook_scanned: 0,
            outlook_total: None,
            teams_scanned: 0,
            teams_total: None,
            teams_chats_discovered: 0,
            teams_chats_scanned: 0,
            teams_chats_total: None,
            analyzed_count: 0,
            analysis_total: None,
        }
    }
}
