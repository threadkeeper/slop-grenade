//! Local-only Gmail orchestration, bounded transactional staging, and quiet recovery.
//!
//! Original message metadata and body are scored only by the local core detector.
//! Every report string is replaced before reaching the ledger or animation bus.
//! Status events contain only `()`; callers must fetch the current local status.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use futures::{stream, StreamExt};
use serde_json::{json, Value};
use tokio::sync::{broadcast, Mutex, RwLock};

use crate::config::AppConfig;
use crate::event_bus::AnimationEventBus;
use crate::gmail_account::{AccountSession, GmailAccount};
use crate::gmail_auth::GmailAuthClient;
use crate::gmail_client::GmailClient;
use crate::gmail_error::GmailError;
use crate::gmail_http::GoogleHttp;
use crate::ledger::AwarenessLedger;
use crate::slop_detector::{MessageDirection, SlopDetector, SlopReport};

const SCAN_DEADLINE: Duration = Duration::from_secs(60);
const MAX_ACCOUNTS: usize = 10;
const MAX_DEDUP_KEYS: usize = 50_000;

/// Coordinates process-local Gmail accounts and never stores tokens or raw mail on disk.
pub struct GmailScanner {
    enabled: bool,
    auth: Option<GmailAuthClient>,
    client: GmailClient,
    accounts: RwLock<BTreeMap<String, Arc<GmailAccount>>>,
    authorization_lock: Mutex<()>,
    poll_lock: Mutex<()>,
    ledger: Arc<AwarenessLedger>,
    bus: Arc<AnimationEventBus>,
    changes: broadcast::Sender<()>,
    #[cfg(test)]
    reject_next_batch: std::sync::atomic::AtomicBool,
}

struct StagedBatch {
    reports: Vec<SlopReport>,
    keys: Vec<String>,
    history_id: String,
    fetched: usize,
    quiet: bool,
}

impl GmailScanner {
    /// Create a Gmail scanner with fixed production endpoints and a loopback callback.
    ///
    /// Missing client configuration leaves status available but fails authorization
    /// explicitly. Tokens intentionally do not survive a process restart.
    pub fn new(
        config: &AppConfig,
        redirect_uri: String,
        ledger: Arc<AwarenessLedger>,
        bus: Arc<AnimationEventBus>,
    ) -> Result<Self, String> {
        Self::with_http(
            config,
            redirect_uri,
            ledger,
            bus,
            GoogleHttp::production().map_err(|error| error.safe_message().to_owned())?,
        )
        .map_err(|error| error.safe_message().to_owned())
    }

    fn with_http(
        config: &AppConfig,
        redirect_uri: String,
        ledger: Arc<AwarenessLedger>,
        bus: Arc<AnimationEventBus>,
        http: GoogleHttp,
    ) -> Result<Self, GmailError> {
        let auth = config
            .gmail_oauth_client_id
            .as_ref()
            .map(|client_id| {
                GmailAuthClient::with_http(client_id.clone(), redirect_uri, http.clone())
            })
            .transpose()?;
        let (changes, _) = broadcast::channel(32);
        Ok(Self {
            enabled: config.gmail_enabled,
            auth,
            client: GmailClient::with_http(http),
            accounts: RwLock::new(BTreeMap::new()),
            authorization_lock: Mutex::new(()),
            poll_lock: Mutex::new(()),
            ledger,
            bus,
            changes,
            #[cfg(test)]
            reject_next_batch: std::sync::atomic::AtomicBool::new(false),
        })
    }

    fn auth(&self) -> Result<&GmailAuthClient, GmailError> {
        if !self.enabled {
            return Err(GmailError::Disabled);
        }
        self.auth.as_ref().ok_or(GmailError::NotConfigured)
    }

    /// Read process-local connection labels and safe status, never tokens or mail.
    pub async fn status(&self) -> Value {
        let accounts: Vec<_> = self
            .accounts
            .read()
            .await
            .values()
            .map(|account| account.status())
            .collect();
        json!({
            "enabled": self.enabled,
            "configured": self.auth.is_some(),
            "accounts": accounts,
            "authorizationPending": self.auth.as_ref().is_some_and(GmailAuthClient::is_pending),
        })
    }

    /// Begin five-minute, single-use read-only consent, optionally for a specific account.
    pub async fn authorize(&self, reconnect_id: Option<&str>) -> Result<Value, GmailError> {
        let _guard = self
            .authorization_lock
            .try_lock()
            .map_err(|_| GmailError::Busy)?;
        let auth = self.auth()?;
        if let Some(id) = reconnect_id {
            if !self.accounts.read().await.contains_key(id) {
                return Err(GmailError::NotFound);
            }
        }
        let value = auth.begin(reconnect_id)?;
        let _ = self.changes.send(());
        Ok(value)
    }

    /// Consume callback state, exchange the code, and verify a profile before connection.
    pub async fn complete_authorization(
        &self,
        state: Option<&str>,
        code: Option<&str>,
        error: Option<&str>,
    ) -> Result<(), GmailError> {
        let _transaction = self.ledger.communication_gate().read().await;
        let _guard = self.authorization_lock.lock().await;
        let result = self.complete_inner(state, code, error).await;
        let _ = self.changes.send(());
        result
    }

    async fn complete_inner(
        &self,
        state: Option<&str>,
        code: Option<&str>,
        error: Option<&str>,
    ) -> Result<(), GmailError> {
        let auth = self.auth()?;
        let authorized = auth.complete(state, code, error).await?;
        let id = GmailAccount::identity(&authorized.profile.email_address);
        if authorized
            .reconnect_id
            .as_ref()
            .is_some_and(|expected| expected != &id)
        {
            let _ = auth.revoke(&authorized.tokens).await;
            return Err(GmailError::WrongAccount);
        }
        let previous = self.accounts.read().await.get(&id).cloned();
        if previous.is_none() && self.accounts.read().await.len() >= MAX_ACCOUNTS {
            let _ = auth.revoke(&authorized.tokens).await;
            return Err(GmailError::LimitExceeded);
        }
        let account = Arc::new(GmailAccount::new(authorized.profile, authorized.tokens));
        if let Some(previous) = previous {
            previous.deactivate()?;
            let mut previous = previous.session.lock().await;
            let mut session = account.session.lock().await;
            session.history_id = previous.history_id.take();
            session.seen = std::mem::take(&mut previous.seen);
            previous.tokens = None;
        }
        self.accounts.write().await.insert(id, account);
        Ok(())
    }

    /// Stop future scans, erase account state, and attempt Google grant revocation.
    ///
    /// Local removal always succeeds even when the network is unavailable.
    pub async fn disconnect(&self, id: &str) -> Result<(), GmailError> {
        let _guard = self.authorization_lock.lock().await;
        let account = self
            .accounts
            .write()
            .await
            .remove(id)
            .ok_or(GmailError::NotFound)?;
        account.deactivate()?;
        if let Some(auth) = &self.auth {
            auth.cancel_reconnect(id);
        }
        let mut session = account.session.lock().await;
        let tokens = session.tokens.take();
        session.history_id = None;
        session.seen.clear();
        let _ = self.changes.send(());
        if let (Some(auth), Some(tokens)) = (&self.auth, tokens) {
            let _ = auth.revoke(&tokens).await;
        }
        Ok(())
    }

    /// Erase Gmail authorization progress, history checkpoints, and deduplication keys.
    ///
    /// Connected accounts and their memory-only tokens remain available unless separately
    /// disconnected. The caller must hold the ledger's exclusive communication gate
    /// through the complete cross-provider wipe.
    pub async fn clear_communication_state(&self) -> Result<usize, GmailError> {
        let _authorization = self.authorization_lock.lock().await;
        let _poll = self.poll_lock.lock().await;
        if let Some(auth) = &self.auth {
            auth.cancel_pending()?;
        }
        let accounts: Vec<_> = self.accounts.read().await.values().cloned().collect();
        let mut removed = 0;
        for account in accounts {
            let mut session = account.session.lock().await;
            removed += session.seen.len();
            session.seen.clear();
            session.history_id = None;
        }
        let _ = self.changes.send(());
        Ok(removed)
    }

    /// Scan all accounts independently; return only counts and safe account errors.
    pub async fn scan_once(&self) -> Result<Value, GmailError> {
        let _transaction = self.ledger.communication_gate().read().await;
        self.auth()?;
        let _guard = self.poll_lock.try_lock().map_err(|_| GmailError::Busy)?;
        let accounts: Vec<_> = self.accounts.read().await.values().cloned().collect();
        let results = stream::iter(accounts.into_iter().map(|account| async move {
            let result = tokio::time::timeout(SCAN_DEADLINE, self.scan_account(&account))
                .await
                .unwrap_or(Err(GmailError::LimitExceeded));
            if let Err(error) = result {
                account.failed(error);
            }
            (account.id().to_owned(), result)
        }))
        .buffer_unordered(4)
        .collect::<Vec<_>>()
        .await;
        let mut fetched = 0;
        let mut analyzed = 0;
        let mut animations = 0;
        let mut successful = 0;
        let mut errors = Vec::new();
        for (id, result) in results {
            match result {
                Ok((count, reports, events)) => {
                    fetched += count;
                    analyzed += reports;
                    animations += events;
                    successful += 1;
                }
                Err(error) => errors.push(json!({"id": id, "error": error.safe_message()})),
            }
        }
        let _ = self.changes.send(());
        Ok(json!({
            "fetchedCount": fetched, "newMessagesAnalyzed": analyzed,
            "animationsTriggered": animations, "successfulAccounts": successful,
            "failedAccounts": errors.len(), "errors": errors,
        }))
    }

    async fn scan_account(
        &self,
        account: &GmailAccount,
    ) -> Result<(usize, usize, usize), GmailError> {
        let mut cancellation = account.cancellation();
        if *cancellation.borrow() {
            return Err(GmailError::NotFound);
        }
        tokio::select! {
            biased;
            _ = cancellation.changed() => Err(GmailError::NotFound),
            result = self.scan_active_account(account) => result,
        }
    }

    async fn scan_active_account(
        &self,
        account: &GmailAccount,
    ) -> Result<(usize, usize, usize), GmailError> {
        // Holding this lock serializes both access-token refresh and checkpoint updates.
        let mut session = account.session.lock().await;
        if !account.is_active() {
            return Err(GmailError::NotFound);
        }
        let auth = self.auth()?;
        let tokens = session
            .tokens
            .as_mut()
            .ok_or(GmailError::ReconnectRequired)?;
        if let Err(error) = auth.refresh(tokens).await {
            if error == GmailError::ReconnectRequired {
                session.tokens = None;
            }
            return Err(error);
        }
        let staged = self.stage(account, &session).await;
        let staged = match staged {
            Ok(staged) => staged,
            Err(error) => {
                if error == GmailError::ReconnectRequired {
                    session.tokens = None;
                }
                return Err(error);
            }
        };
        let _commit = account.commit.lock().map_err(|_| GmailError::Internal)?;
        if !account.is_active() {
            return Err(GmailError::NotFound);
        }
        if session.seen.len().saturating_add(staged.keys.len()) > MAX_DEDUP_KEYS {
            return Err(GmailError::LimitExceeded);
        }
        let analyzed = staged.reports.len();
        let animations = if staged.quiet { 0 } else { analyzed };
        // Disconnect/reconnect share the commit gate. Acceptance, effects, and
        // checkpoint mutation cannot race account deactivation and never await.
        self.accept_batch(staged.reports.clone())?;
        for report in staged.reports {
            if !staged.quiet {
                self.bus.publish(report);
            }
        }
        session.seen.extend(staged.keys);
        session.history_id = Some(staged.history_id);
        account.succeeded();
        Ok((staged.fetched, analyzed, animations))
    }

    fn accept_batch(&self, reports: Vec<SlopReport>) -> Result<(), GmailError> {
        #[cfg(test)]
        if self
            .reject_next_batch
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err(GmailError::Internal);
        }
        self.ledger
            .try_record_batch(reports)
            .map_err(|_| GmailError::Internal)
    }

    async fn stage(
        &self,
        account: &GmailAccount,
        session: &AccountSession,
    ) -> Result<StagedBatch, GmailError> {
        let access = session
            .tokens
            .as_ref()
            .ok_or(GmailError::ReconnectRequired)?
            .access
            .as_str();
        let client = self.client.for_account(account.id());
        let (ids, history_id, quiet) = if let Some(history) = &session.history_id {
            match client.history(access, history).await {
                Ok(batch) => (batch.ids, batch.history_id, false),
                Err(GmailError::HistoryExpired) => self.initial(&client, access, account).await?,
                Err(error) => return Err(error),
            }
        } else {
            self.initial(&client, access, account).await?
        };
        let fetched = ids.len();
        let mut reports = Vec::new();
        let mut keys = Vec::new();
        let detector = SlopDetector::new();
        for id in ids {
            let key = account.message_key(&id);
            if session.seen.contains(&key) {
                continue;
            }
            let message = client.message(access, &id).await?;
            if let Some(mut sample) = message.sample(account.label(), key.clone())? {
                let report = sanitize_report(detector.analyze(&sample));
                // Clear transient content promptly, before the next network request.
                zeroize::Zeroize::zeroize(&mut sample.body);
                zeroize::Zeroize::zeroize(&mut sample.sender);
                zeroize::Zeroize::zeroize(&mut sample.subject_or_topic);
                reports.push(report);
            }
            keys.push(key);
        }
        Ok(StagedBatch {
            reports,
            keys,
            history_id,
            fetched,
            quiet,
        })
    }

    async fn initial(
        &self,
        client: &GmailClient,
        access: &str,
        account: &GmailAccount,
    ) -> Result<(Vec<String>, String, bool), GmailError> {
        // Snapshot BEFORE enumeration. A change during enumeration remains visible
        // to the next history call and cannot be accidentally checkpointed away.
        let profile = client.profile(access).await?;
        if GmailAccount::identity(&profile.email_address) != account.id() {
            return Err(GmailError::WrongAccount);
        }
        let ids = client.initial_ids(access).await?;
        Ok((ids, profile.history_id, true))
    }

    /// Subscribe to content-free account status notifications.
    pub fn subscribe(&self) -> broadcast::Receiver<()> {
        self.changes.subscribe()
    }

    /// Poll locally at an interval of at least thirty seconds; never retry in a tight loop.
    pub fn spawn_background_loop(self: Arc<Self>, interval_secs: u64) {
        tokio::spawn(async move {
            let mut interval =
                tokio::time::interval(Duration::from_secs(interval_secs.clamp(30, 86_400)));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                interval.tick().await;
                let _ = self.scan_once().await;
            }
        });
    }
}

fn sanitize_report(mut report: SlopReport) -> SlopReport {
    report.sender = match report.direction {
        MessageDirection::Sent => "Me (Gmail)",
        MessageDirection::Received => "Gmail correspondent",
    }
    .into();
    report.subject_or_topic = "Gmail message (private)".into();
    report.summary = format!(
        "Local Gmail writing-style score: {}/100.",
        report.slop_score
    );
    report.self_awareness_tip =
        "Review the local style signals; message content is not retained.".into();
    report.redacted_preview = "[Gmail content not retained]".into();
    for signal in &mut report.signals {
        signal.label = "Local writing-style signal".into();
        signal.excerpt = "[Private]".into();
    }
    report
}

#[cfg(test)]
#[path = "gmail_tests.rs"]
mod tests;
