//! Fixed-endpoint, bounded, TLS-verified Google transport without proxies or redirects.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use reqwest::{Client, RequestBuilder, StatusCode};
use serde::de::DeserializeOwned;
use sha2::{Digest, Sha256};
use tokio::time::Instant;
use zeroize::Zeroizing;

use crate::gmail_error::GmailError;

const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_ATTEMPTS: u32 = 3;
const MAX_COOLDOWNS: usize = 64;

struct Cooldown {
    expires: Option<Instant>,
    error: GmailError,
}

#[derive(Clone)]
pub(crate) struct GoogleHttp {
    client: Client,
    cooldowns: Arc<Mutex<HashMap<[u8; 32], Cooldown>>>,
    account_key: Option<[u8; 32]>,
    pub(crate) authorization: String,
    pub(crate) token: String,
    pub(crate) revoke: String,
    pub(crate) api: String,
}

impl GoogleHttp {
    pub(crate) fn production() -> Result<Self, GmailError> {
        Ok(Self {
            client: Self::client(true)?,
            cooldowns: Arc::new(Mutex::new(HashMap::new())),
            account_key: None,
            authorization: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token: "https://oauth2.googleapis.com/token".into(),
            revoke: "https://oauth2.googleapis.com/revoke".into(),
            api: "https://gmail.googleapis.com/gmail/v1/users/me".into(),
        })
    }

    fn client(https_only: bool) -> Result<Client, GmailError> {
        Client::builder()
            .https_only(https_only)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| GmailError::Internal)
    }

    #[cfg(test)]
    pub(crate) fn fake(base: &str) -> Result<Self, GmailError> {
        let url = reqwest::Url::parse(base).map_err(|_| GmailError::Internal)?;
        let loopback = url
            .host_str()
            .and_then(|host| {
                host.trim_matches(['[', ']'])
                    .parse::<std::net::IpAddr>()
                    .ok()
            })
            .is_some_and(|ip| ip.is_loopback());
        if !loopback
            || url.scheme() != "http"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(GmailError::Internal);
        }
        Ok(Self {
            client: Self::client(false)?,
            cooldowns: Arc::new(Mutex::new(HashMap::new())),
            account_key: None,
            authorization: format!("{base}/authorize"),
            token: format!("{base}/token"),
            revoke: format!("{base}/revoke"),
            api: format!("{base}/gmail/v1/users/me"),
        })
    }

    pub(crate) fn get(&self, path: &str, bearer: &str) -> RequestBuilder {
        self.client
            .get(format!("{}{path}", self.api))
            .bearer_auth(bearer)
    }

    pub(crate) fn for_account(&self, id: &str) -> Self {
        let mut http = self.clone();
        http.account_key = Some(Sha256::digest(id.as_bytes()).into());
        http
    }

    pub(crate) fn post(&self, endpoint: &str) -> RequestBuilder {
        self.client.post(endpoint)
    }

    pub(crate) async fn json<T: DeserializeOwned>(
        &self,
        request: RequestBuilder,
        retry: bool,
    ) -> Result<T, GmailError> {
        let bytes = self.bytes(request, retry).await?;
        serde_json::from_slice(&bytes).map_err(|_| GmailError::InvalidResponse)
    }

    pub(crate) async fn bytes(
        &self,
        request: RequestBuilder,
        retry: bool,
    ) -> Result<Zeroizing<Vec<u8>>, GmailError> {
        let request = request.build().map_err(|_| GmailError::Internal)?;
        let account_key = retry
            .then(|| {
                self.account_key.or_else(|| {
                    request
                        .headers()
                        .get(reqwest::header::AUTHORIZATION)
                        .map(|value| <[u8; 32]>::from(Sha256::digest(value.as_bytes())))
                })
            })
            .flatten();
        for attempt in 0..MAX_ATTEMPTS {
            if let Some(key) = &account_key {
                self.check_cooldown(key)?;
            }
            let mut response = self
                .client
                .execute(request.try_clone().ok_or(GmailError::Internal)?)
                .await
                .map_err(|_| GmailError::Network)?;
            let status = response.status();
            // A 401 invalidates credentials regardless of malformed or oversized error content.
            if status == StatusCode::UNAUTHORIZED {
                return Err(GmailError::ReconnectRequired);
            }
            let delay = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(retry_after);
            if retry && retryable(status) {
                if let (Some(key), Some(delay)) = (account_key, delay) {
                    self.remember_cooldown(key, delay, classify(status, &[]))?;
                }
            }
            if retry && retryable(status) && attempt + 1 < MAX_ATTEMPTS {
                let mut random = [0; 2];
                getrandom::fill(&mut random).map_err(|_| GmailError::Internal)?;
                let jitter = u16::from_le_bytes(random) as u64 % 250;
                let backoff = Duration::from_millis(500 * (1 << attempt) + jitter);
                let wait = delay.map_or(backoff, |delay| delay.max(backoff));
                // Preserve long Retry-After across subsequent polls without blocking other accounts.
                if wait > Duration::from_secs(10) {
                    return Err(classify(status, &[]));
                }
                tokio::time::sleep(wait).await;
                continue;
            }
            if response
                .content_length()
                .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
            {
                return Err(GmailError::LimitExceeded);
            }
            let mut bytes = Zeroizing::new(Vec::new());
            while let Some(chunk) = response.chunk().await.map_err(|_| GmailError::Network)? {
                if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
                    return Err(GmailError::LimitExceeded);
                }
                bytes.extend_from_slice(&chunk);
            }
            if !status.is_success() {
                return Err(classify(status, &bytes));
            }
            return Ok(bytes);
        }
        Err(GmailError::Unavailable)
    }

    fn check_cooldown(&self, key: &[u8; 32]) -> Result<(), GmailError> {
        let mut cooldowns = self.cooldowns.lock().map_err(|_| GmailError::Internal)?;
        cooldowns.retain(|_, cooldown| {
            cooldown
                .expires
                .is_none_or(|expires| expires > Instant::now())
        });
        match cooldowns.get(key) {
            Some(cooldown) => Err(cooldown.error),
            None => Ok(()),
        }
    }

    fn remember_cooldown(
        &self,
        key: [u8; 32],
        delay: Duration,
        error: GmailError,
    ) -> Result<(), GmailError> {
        let mut cooldowns = self.cooldowns.lock().map_err(|_| GmailError::Internal)?;
        cooldowns.retain(|_, cooldown| {
            cooldown
                .expires
                .is_none_or(|expires| expires > Instant::now())
        });
        if !cooldowns.contains_key(&key) && cooldowns.len() >= MAX_COOLDOWNS {
            return Err(GmailError::LimitExceeded);
        }
        cooldowns.insert(
            key,
            Cooldown {
                expires: Instant::now().checked_add(delay),
                error,
            },
        );
        Ok(())
    }
}

fn retryable(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

fn retry_after(value: &str) -> Option<Duration> {
    value
        .parse::<u64>()
        .ok()
        .map(Duration::from_secs)
        .or_else(|| {
            chrono::DateTime::parse_from_rfc2822(value)
                .ok()
                .map(|date| {
                    Duration::from_secs(
                        (date.timestamp() - chrono::Utc::now().timestamp()).max(0) as u64
                    )
                })
        })
}

fn classify(status: StatusCode, bytes: &[u8]) -> GmailError {
    let json: serde_json::Value = serde_json::from_slice(bytes).unwrap_or_default();
    match json.get("error").and_then(|value| value.as_str()) {
        Some("invalid_grant" | "invalid_token") => return GmailError::ReconnectRequired,
        Some("admin_policy_enforced" | "org_internal" | "restricted_client") => {
            return GmailError::PolicyDenied
        }
        Some("access_denied") => return GmailError::AccessDenied,
        _ => {}
    }
    match status {
        StatusCode::UNAUTHORIZED => GmailError::ReconnectRequired,
        StatusCode::NOT_FOUND => GmailError::HistoryExpired,
        StatusCode::TOO_MANY_REQUESTS => GmailError::RateLimited,
        status if status.is_server_error() => GmailError::Unavailable,
        _ => GmailError::InvalidResponse,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transport_is_closed_and_errors_never_echo_google_content() {
        assert!(GoogleHttp::fake("http://example.test").is_err());
        assert!(GoogleHttp::fake("http://user:secret@127.0.0.1").is_err());
        assert_eq!(
            classify(
                StatusCode::BAD_REQUEST,
                br#"{"error":"invalid_grant","secret":"synthetic-secret"}"#
            ),
            GmailError::ReconnectRequired
        );
        assert_eq!(
            classify(
                StatusCode::FORBIDDEN,
                br#"{"error":"admin_policy_enforced"}"#
            ),
            GmailError::PolicyDenied
        );
        assert!(retryable(StatusCode::TOO_MANY_REQUESTS));
        assert!(retryable(StatusCode::SERVICE_UNAVAILABLE));
        assert!(!retryable(StatusCode::BAD_REQUEST));
        assert_eq!(retry_after("90"), Some(Duration::from_secs(90)));
    }

    #[tokio::test(start_paused = true)]
    async fn retry_after_cooldown_expires_is_account_scoped_and_has_bounded_storage() {
        let http = GoogleHttp::fake("http://127.0.0.1:8090").expect("transport");
        let one = [1; 32];
        let two = [2; 32];
        http.remember_cooldown(one, Duration::from_secs(90), GmailError::RateLimited)
            .expect("cooldown");
        assert_eq!(http.check_cooldown(&one), Err(GmailError::RateLimited));
        assert_eq!(http.check_cooldown(&two), Ok(()));
        tokio::time::advance(Duration::from_secs(90)).await;
        assert_eq!(http.check_cooldown(&one), Ok(()));
        for index in 0..MAX_COOLDOWNS {
            http.remember_cooldown([index as u8; 32], Duration::MAX, GmailError::Unavailable)
                .expect("bounded entry");
        }
        assert_eq!(
            http.remember_cooldown([255; 32], Duration::MAX, GmailError::Unavailable),
            Err(GmailError::LimitExceeded)
        );
    }
}
