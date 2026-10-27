//! Process-local Gmail account identity, connection state, and hashed deduplication.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::gmail_auth::{GmailProfile, GmailTokens};
use crate::gmail_error::GmailError;

/// Memory-only account. Intentionally has no `Debug` or serialization implementation.
pub struct GmailAccount {
    id: String,
    label: String,
    pub(crate) active: AtomicBool,
    pub(crate) commit: Mutex<()>,
    pub(crate) session: tokio::sync::Mutex<AccountSession>,
    deactivated: tokio::sync::watch::Sender<bool>,
    status: Mutex<AccountStatus>,
}

pub(crate) struct AccountSession {
    pub(crate) tokens: Option<GmailTokens>,
    pub(crate) history_id: Option<String>,
    pub(crate) seen: HashSet<String>,
}

#[derive(Default)]
struct AccountStatus {
    connected: bool,
    reconnect_required: bool,
    last_successful_scan: Option<String>,
    error: Option<GmailError>,
}

impl GmailAccount {
    pub(crate) fn new(profile: GmailProfile, tokens: GmailTokens) -> Self {
        let (deactivated, _) = tokio::sync::watch::channel(false);
        Self {
            id: Self::identity(&profile.email_address),
            label: profile.email_address,
            active: AtomicBool::new(true),
            commit: Mutex::new(()),
            session: tokio::sync::Mutex::new(AccountSession {
                tokens: Some(tokens),
                history_id: None,
                seen: HashSet::new(),
            }),
            deactivated,
            status: Mutex::new(AccountStatus {
                connected: true,
                ..AccountStatus::default()
            }),
        }
    }

    /// Account identifier is a SHA-256 hash, never a Google ID or address.
    pub fn id(&self) -> &str {
        &self.id
    }

    pub(crate) fn label(&self) -> &str {
        &self.label
    }

    pub(crate) fn identity(email: &str) -> String {
        hash(&["gmail-account-v1", &email.trim().to_ascii_lowercase()])
    }

    pub(crate) fn message_key(&self, message_id: &str) -> String {
        hash(&["gmail-message-v1", &self.id, message_id])
    }

    pub(crate) fn is_active(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }

    pub(crate) fn cancellation(&self) -> tokio::sync::watch::Receiver<bool> {
        self.deactivated.subscribe()
    }

    pub(crate) fn deactivate(&self) -> Result<(), GmailError> {
        let _commit = self.commit.lock().map_err(|_| GmailError::Internal)?;
        self.active.store(false, Ordering::Release);
        self.deactivated.send_replace(true);
        Ok(())
    }

    pub(crate) fn status(&self) -> Value {
        let status = self
            .status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut value = json!({
            "id": self.id, "label": self.label,
            "connected": status.connected && self.is_active(),
            "reconnectRequired": status.reconnect_required,
            "lastSuccessfulScan": status.last_successful_scan,
        });
        if let Some(error) = status.error {
            value["error"] = Value::String(error.safe_message().into());
        }
        value
    }

    pub(crate) fn failed(&self, error: GmailError) {
        let mut status = self
            .status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        status.error = Some(error);
        if error == GmailError::ReconnectRequired {
            status.connected = false;
            status.reconnect_required = true;
        }
    }

    pub(crate) fn succeeded(&self) {
        let mut status = self
            .status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        status.last_successful_scan = Some(chrono::Utc::now().to_rfc3339());
        status.error = None;
    }
}

fn hash(parts: &[&str]) -> String {
    let mut hash = Sha256::new();
    for part in parts {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    format!("{:x}", hash.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identities_and_message_keys_are_account_scoped_and_unambiguous() {
        assert_eq!(
            GmailAccount::identity("ONE@example.invalid"),
            GmailAccount::identity("one@example.invalid")
        );
        assert_ne!(
            GmailAccount::identity("one@example.invalid"),
            GmailAccount::identity("two@example.invalid")
        );
        assert_ne!(hash(&["ab", "c"]), hash(&["a", "bc"]));
        assert_eq!(hash(&["synthetic"]).len(), 64);
    }
}
