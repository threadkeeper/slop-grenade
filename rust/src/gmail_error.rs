//! Closed, content-free Gmail errors safe for HTTP responses and diagnostics.

use std::fmt;

/// Gmail failures contain no remote text, account identifiers, or credentials.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GmailError {
    /// Gmail has been disabled by local configuration.
    Disabled,
    /// The release or environment does not supply a desktop OAuth client ID.
    NotConfigured,
    /// Another authorization or scan is already in progress.
    Busy,
    /// Callback state is missing, invalid, expired, or already consumed.
    InvalidState,
    /// The user declined consent.
    AccessDenied,
    /// Google Workspace or OAuth organization policy blocked authorization.
    PolicyDenied,
    /// The callback does not contain a valid authorization code.
    InvalidCallback,
    /// The requested local account no longer exists.
    NotFound,
    /// Reconnection selected a different Google account.
    WrongAccount,
    /// Google credentials expired or were revoked; consent is required again.
    ReconnectRequired,
    /// Google no longer retains the saved history checkpoint.
    HistoryExpired,
    /// Google temporarily limited request frequency.
    RateLimited,
    /// Google is temporarily unavailable.
    Unavailable,
    /// The secure request failed without exposing its URL or response.
    Network,
    /// Google returned incomplete or malformed data.
    InvalidResponse,
    /// A bounded safety limit was reached; the checkpoint is unchanged.
    LimitExceeded,
    /// Local state or secure randomness could not be obtained.
    Internal,
}

impl GmailError {
    /// HTTP status appropriate for the safe public error.
    pub fn status_code(&self) -> u16 {
        match self {
            Self::Disabled | Self::AccessDenied | Self::PolicyDenied => 403,
            Self::NotConfigured => 503,
            Self::Busy | Self::WrongAccount => 409,
            Self::InvalidState | Self::InvalidCallback => 400,
            Self::NotFound => 404,
            Self::ReconnectRequired => 401,
            Self::RateLimited => 429,
            Self::LimitExceeded => 422,
            Self::Internal => 500,
            _ => 502,
        }
    }

    /// Fixed actionable message containing no upstream or personal content.
    pub fn safe_message(&self) -> &'static str {
        match self {
            Self::Disabled => "Gmail monitoring is disabled.",
            Self::NotConfigured => "Gmail requires a configured Google desktop OAuth client ID.",
            Self::Busy => "A Gmail operation is already in progress. Try again shortly.",
            Self::InvalidState => {
                "Gmail authorization expired or was invalid. Start authorization again."
            }
            Self::AccessDenied => "Gmail consent was declined. Connect again when ready.",
            Self::PolicyDenied => {
                "Google organization policy blocked Gmail access. Contact your administrator."
            }
            Self::InvalidCallback => {
                "Gmail authorization did not complete. Start authorization again."
            }
            Self::NotFound => "The Gmail account is not connected.",
            Self::WrongAccount => "Reconnect with the originally selected Google account.",
            Self::ReconnectRequired => {
                "Gmail authorization is no longer valid. Reconnect this account."
            }
            Self::HistoryExpired => "Gmail history expired. A quiet recovery scan is required.",
            Self::RateLimited => "Google temporarily limited Gmail requests. Try again later.",
            Self::Unavailable => "Google is temporarily unavailable. Try again later.",
            Self::Network => "The secure connection to Google failed. Try again later.",
            Self::InvalidResponse => {
                "Gmail returned incomplete or unsupported data. No checkpoint was advanced."
            }
            Self::LimitExceeded => {
                "The Gmail scan reached a safety limit. No checkpoint was advanced."
            }
            Self::Internal => "Local Gmail state is unavailable. Try again or restart the daemon.",
        }
    }
}

impl fmt::Display for GmailError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.safe_message())
    }
}

impl std::error::Error for GmailError {}
