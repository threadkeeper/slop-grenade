//! Stages of a quiet history refresh, without message content.

use serde::Serialize;

/// Current stage of an Outlook and Teams history refresh.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RefreshPhase {
    /// Resolving the existing WorkIQ account.
    Connecting,
    /// Reading Outlook message pages.
    Outlook,
    /// Discovering active chats and reading Teams message pages.
    Teams,
    /// Locally scoring and merging newly discovered messages.
    Analyzing,
    /// Every fetched message has been considered for the ledger.
    Completed,
    /// The refresh stopped with an error returned by its original request.
    Failed,
}
