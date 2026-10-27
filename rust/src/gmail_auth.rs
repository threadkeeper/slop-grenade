//! Memory-only installed-application OAuth, single-use state, and S256 PKCE.
//!
//! No client secret, endpoint override, proxy, token serialization, or sensitive
//! `Debug` implementation is exposed by this module.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::gmail_error::GmailError;
use crate::gmail_http::GoogleHttp;

const READONLY_SCOPE: &str = "https://www.googleapis.com/auth/gmail.readonly";
const STATE_LIFETIME: Duration = Duration::from_secs(300);

/// Google installed-app authentication client; credentials live only in memory.
pub struct GmailAuthClient {
    http: GoogleHttp,
    client_id: String,
    redirect_uri: String,
    pending: Mutex<Option<PendingAuthorization>>,
}

struct PendingAuthorization {
    state: Zeroizing<String>,
    verifier: Zeroizing<String>,
    expires: Instant,
    reconnect_id: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Zeroizing<String>,
    refresh_token: Option<Zeroizing<String>>,
    expires_in: u64,
    token_type: String,
    scope: Option<String>,
}

pub(crate) struct GmailTokens {
    pub(crate) access: Zeroizing<String>,
    pub(crate) refresh: Zeroizing<String>,
    pub(crate) expires: Instant,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GmailProfile {
    pub(crate) email_address: String,
    pub(crate) history_id: String,
}

pub(crate) struct AuthorizedAccount {
    pub(crate) profile: GmailProfile,
    pub(crate) tokens: GmailTokens,
    pub(crate) reconnect_id: Option<String>,
}

impl GmailAuthClient {
    /// Create an authenticator using only fixed production Google HTTPS endpoints.
    ///
    /// The callback must be an HTTP IP-literal loopback URI without credentials,
    /// query parameters, or a fragment. No Google client secret is accepted.
    pub fn new(client_id: String, redirect_uri: String) -> Result<Self, GmailError> {
        Self::with_http(client_id, redirect_uri, GoogleHttp::production()?)
    }

    pub(crate) fn with_http(
        client_id: String,
        redirect_uri: String,
        http: GoogleHttp,
    ) -> Result<Self, GmailError> {
        let redirect =
            reqwest::Url::parse(&redirect_uri).map_err(|_| GmailError::InvalidCallback)?;
        let is_loopback = redirect
            .host_str()
            .and_then(|host| {
                host.trim_matches(['[', ']'])
                    .parse::<std::net::IpAddr>()
                    .ok()
            })
            .is_some_and(|ip| ip.is_loopback());
        if redirect.scheme() != "http"
            || !is_loopback
            || !redirect.username().is_empty()
            || redirect.password().is_some()
            || redirect.query().is_some()
            || redirect.fragment().is_some()
        {
            return Err(GmailError::InvalidCallback);
        }
        if client_id.is_empty()
            || client_id.len() > 512
            || !client_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'_'))
        {
            return Err(GmailError::NotConfigured);
        }
        Ok(Self {
            http,
            client_id,
            redirect_uri,
            pending: Mutex::new(None),
        })
    }

    pub(crate) fn begin(&self, reconnect_id: Option<&str>) -> Result<Value, GmailError> {
        let mut pending = self.pending.lock().map_err(|_| GmailError::Internal)?;
        if pending
            .as_ref()
            .is_some_and(|pending| pending.expires > Instant::now())
        {
            return Err(GmailError::Busy);
        }
        let state = random_secret()?;
        let verifier = random_secret()?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut url =
            reqwest::Url::parse(&self.http.authorization).map_err(|_| GmailError::Internal)?;
        url.query_pairs_mut().extend_pairs([
            ("client_id", self.client_id.as_str()),
            ("redirect_uri", self.redirect_uri.as_str()),
            ("response_type", "code"),
            ("scope", READONLY_SCOPE),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("state", state.as_str()),
            ("access_type", "offline"),
            // Every authorization creates a new memory-only session and needs a refresh token.
            ("prompt", "consent"),
        ]);
        *pending = Some(PendingAuthorization {
            state,
            verifier,
            expires: Instant::now() + STATE_LIFETIME,
            reconnect_id: reconnect_id.map(str::to_owned),
        });
        Ok(json!({
            "authorizationUrl": url.as_str(),
            "expiresAt": (chrono::Utc::now() + chrono::Duration::minutes(5)).to_rfc3339(),
        }))
    }

    pub(crate) fn is_pending(&self) -> bool {
        self.pending.lock().ok().is_some_and(|pending| {
            pending
                .as_ref()
                .is_some_and(|pending| pending.expires > Instant::now())
        })
    }

    pub(crate) fn cancel_reconnect(&self, id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            if pending
                .as_ref()
                .is_some_and(|pending| pending.reconnect_id.as_deref() == Some(id))
            {
                *pending = None;
            }
        }
    }

    pub(crate) fn cancel_pending(&self) -> Result<(), GmailError> {
        *self.pending.lock().map_err(|_| GmailError::Internal)? = None;
        Ok(())
    }

    fn consume(&self, state: Option<&str>) -> Result<PendingAuthorization, GmailError> {
        let state = state.ok_or(GmailError::InvalidState)?;
        let mut guard = self.pending.lock().map_err(|_| GmailError::Internal)?;
        if guard
            .as_ref()
            .is_some_and(|pending| pending.expires <= Instant::now())
        {
            *guard = None;
            return Err(GmailError::InvalidState);
        }
        let pending = guard.as_ref().ok_or(GmailError::InvalidState)?;
        if !constant_time_equal(pending.state.as_bytes(), state.as_bytes()) {
            return Err(GmailError::InvalidState);
        }
        guard.take().ok_or(GmailError::InvalidState)
    }

    pub(crate) async fn complete(
        &self,
        state: Option<&str>,
        code: Option<&str>,
        error: Option<&str>,
    ) -> Result<AuthorizedAccount, GmailError> {
        let pending = self.consume(state)?;
        if let Some(error) = error {
            return Err(match error {
                "access_denied" => GmailError::AccessDenied,
                "admin_policy_enforced" | "org_internal" | "restricted_client" => {
                    GmailError::PolicyDenied
                }
                _ => GmailError::InvalidCallback,
            });
        }
        let code = code
            .filter(|code| !code.is_empty() && code.len() <= 4096)
            .ok_or(GmailError::InvalidCallback)?;
        let response: TokenResponse = self
            .http
            .json(
                self.http.post(&self.http.token).form(&[
                    ("client_id", self.client_id.as_str()),
                    ("code", code),
                    ("redirect_uri", self.redirect_uri.as_str()),
                    ("code_verifier", pending.verifier.as_str()),
                    ("grant_type", "authorization_code"),
                ]),
                false,
            )
            .await?;
        let tokens = response.into_tokens(None)?;
        let profile = match self.profile(tokens.access.as_str()).await {
            Ok(profile) => profile,
            Err(error) => {
                let _ = self.revoke(&tokens).await;
                return Err(error);
            }
        };
        Ok(AuthorizedAccount {
            profile,
            tokens,
            reconnect_id: pending.reconnect_id,
        })
    }

    pub(crate) async fn profile(&self, access: &str) -> Result<GmailProfile, GmailError> {
        GmailProfile::fetch(&self.http, access).await
    }

    pub(crate) async fn refresh(&self, tokens: &mut GmailTokens) -> Result<(), GmailError> {
        if tokens.expires > Instant::now() + Duration::from_secs(60) {
            return Ok(());
        }
        let response: TokenResponse = self
            .http
            .json(
                self.http.post(&self.http.token).form(&[
                    ("client_id", self.client_id.as_str()),
                    ("refresh_token", tokens.refresh.as_str()),
                    ("grant_type", "refresh_token"),
                ]),
                false,
            )
            .await?;
        let replacement = response.into_tokens(Some(tokens.refresh.clone()))?;
        *tokens = replacement;
        Ok(())
    }

    pub(crate) async fn revoke(&self, tokens: &GmailTokens) -> Result<(), GmailError> {
        self.http
            .bytes(
                self.http
                    .post(&self.http.revoke)
                    .form(&[("token", tokens.refresh.as_str())]),
                false,
            )
            .await?;
        Ok(())
    }
}

impl GmailProfile {
    pub(crate) async fn fetch(http: &GoogleHttp, access: &str) -> Result<Self, GmailError> {
        let profile: Self = http
            .json(
                http.get("/profile", access)
                    .query(&[("fields", "emailAddress,historyId")]),
                true,
            )
            .await?;
        let valid_address = profile
            .email_address
            .split_once('@')
            .is_some_and(|(local, domain)| {
                !local.is_empty()
                    && local.len() <= 64
                    && !domain.is_empty()
                    && !domain.contains('@')
            });
        if profile.email_address.len() > 320
            || !valid_address
            || profile
                .email_address
                .chars()
                .any(|c| c.is_control() || c.is_whitespace())
            || !valid_history_id(&profile.history_id)
        {
            return Err(GmailError::InvalidResponse);
        }
        Ok(profile)
    }
}

impl TokenResponse {
    fn into_tokens(
        self,
        previous_refresh: Option<Zeroizing<String>>,
    ) -> Result<GmailTokens, GmailError> {
        if self.access_token.is_empty()
            || self.access_token.len() > 16 * 1024
            || !self
                .access_token
                .bytes()
                .all(|byte| byte.is_ascii_graphic())
            || !self.token_type.eq_ignore_ascii_case("bearer")
            || self.expires_in == 0
            || self.expires_in > 86_400
            || self
                .scope
                .as_ref()
                .is_some_and(|scope| scope != READONLY_SCOPE)
        {
            return Err(GmailError::InvalidResponse);
        }
        let refresh = self
            .refresh_token
            .or(previous_refresh)
            .filter(|refresh| {
                !refresh.is_empty()
                    && refresh.len() <= 16 * 1024
                    && refresh.bytes().all(|byte| byte.is_ascii_graphic())
            })
            .ok_or(GmailError::ReconnectRequired)?;
        Ok(GmailTokens {
            access: self.access_token,
            refresh,
            expires: Instant::now() + Duration::from_secs(self.expires_in),
        })
    }
}

pub(crate) fn valid_history_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.bytes().all(|byte| byte.is_ascii_digit())
}

fn random_secret() -> Result<Zeroizing<String>, GmailError> {
    let mut bytes = Zeroizing::new([0_u8; 32]);
    getrandom::fill(bytes.as_mut()).map_err(|_| GmailError::Internal)?;
    Ok(Zeroizing::new(URL_SAFE_NO_PAD.encode(bytes.as_ref())))
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn auth() -> GmailAuthClient {
        GmailAuthClient::new(
            "synthetic.apps.googleusercontent.com".into(),
            "http://127.0.0.1:8090/api/v1/auth/google/callback".into(),
        )
        .expect("auth")
    }

    #[test]
    fn pkce_and_single_use_state_are_random_and_scope_is_exact() {
        let auth = auth();
        let first = auth.begin(None).expect("begin");
        let url =
            reqwest::Url::parse(first["authorizationUrl"].as_str().expect("url")).expect("parse");
        let params: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(params["scope"], READONLY_SCOPE);
        assert_eq!(params["code_challenge_method"], "S256");
        assert_eq!(params["response_type"], "code");
        assert_eq!(params["access_type"], "offline");
        assert!(!params.contains_key("client_secret"));
        assert_eq!(
            URL_SAFE_NO_PAD
                .decode(params["state"].as_bytes())
                .expect("state")
                .len(),
            32
        );
        assert_eq!(auth.begin(None), Err(GmailError::Busy));
        assert!(matches!(auth.consume(None), Err(GmailError::InvalidState)));
        assert!(matches!(
            auth.consume(Some("wrong")),
            Err(GmailError::InvalidState)
        ));
        let pending = auth.consume(Some(&params["state"])).expect("consume");
        assert_eq!(
            params["code_challenge"],
            URL_SAFE_NO_PAD.encode(Sha256::digest(pending.verifier.as_bytes()))
        );
        assert!(matches!(
            auth.consume(Some(&params["state"])),
            Err(GmailError::InvalidState)
        ));
        assert_ne!(
            first["authorizationUrl"],
            auth.begin(None).expect("second")["authorizationUrl"]
        );
    }

    #[test]
    fn expired_state_is_erased_and_remote_redirects_rejected() {
        let auth = auth();
        let value = auth.begin(None).expect("begin");
        let state = reqwest::Url::parse(value["authorizationUrl"].as_str().expect("url"))
            .expect("parse")
            .query_pairs()
            .find(|(k, _)| k == "state")
            .expect("state")
            .1
            .into_owned();
        auth.pending
            .lock()
            .expect("lock")
            .as_mut()
            .expect("pending")
            .expires = Instant::now();
        assert!(matches!(
            auth.consume(Some(&state)),
            Err(GmailError::InvalidState)
        ));
        for redirect in [
            "https://example.test/callback",
            "http://localhost/callback",
            "http://user:pass@127.0.0.1/callback",
            "http://127.0.0.1/callback?token=bad",
        ] {
            assert!(GmailAuthClient::new("synthetic".into(), redirect.into()).is_err());
        }
    }

    #[tokio::test]
    async fn policy_denial_is_distinct_and_consumes_state() {
        let auth = auth();
        let value = auth.begin(None).expect("begin");
        let state = reqwest::Url::parse(value["authorizationUrl"].as_str().expect("url"))
            .expect("parse")
            .query_pairs()
            .find(|(k, _)| k == "state")
            .expect("state")
            .1
            .into_owned();
        assert!(matches!(
            auth.complete(Some(&state), None, Some("admin_policy_enforced"))
                .await,
            Err(GmailError::PolicyDenied)
        ));
        assert!(matches!(
            auth.complete(Some(&state), Some("synthetic"), None).await,
            Err(GmailError::InvalidState)
        ));
    }

    #[tokio::test]
    async fn callback_validation_rejects_missing_mismatched_expired_and_missing_code() {
        let auth = auth();
        let value = auth.begin(None).expect("begin");
        let state = reqwest::Url::parse(value["authorizationUrl"].as_str().expect("url"))
            .expect("parse")
            .query_pairs()
            .find(|(k, _)| k == "state")
            .expect("state")
            .1
            .into_owned();
        for state in [None, Some("mismatched")] {
            assert!(matches!(
                auth.complete(state, Some("synthetic"), None).await,
                Err(GmailError::InvalidState)
            ));
        }
        auth.pending
            .lock()
            .expect("lock")
            .as_mut()
            .expect("pending")
            .expires = Instant::now();
        assert!(matches!(
            auth.complete(Some(&state), Some("synthetic"), None).await,
            Err(GmailError::InvalidState)
        ));
        let value = auth.begin(None).expect("begin again");
        let state = reqwest::Url::parse(value["authorizationUrl"].as_str().expect("url"))
            .expect("parse")
            .query_pairs()
            .find(|(k, _)| k == "state")
            .expect("state")
            .1
            .into_owned();
        assert!(matches!(
            auth.complete(Some(&state), None, None).await,
            Err(GmailError::InvalidCallback)
        ));
        assert!(matches!(
            auth.complete(Some(&state), Some("synthetic"), None).await,
            Err(GmailError::InvalidState)
        ));
    }

    #[test]
    fn token_validation_is_closed_and_refresh_preserves_memory_only_refresh_token() {
        let valid = json!({
            "access_token":"synthetic-access", "refresh_token":"synthetic-refresh",
            "expires_in":3600, "token_type":"Bearer", "scope":READONLY_SCOPE,
        });
        for (field, invalid) in [
            ("access_token", json!("")),
            ("access_token", json!("synthetic\nvalue")),
            ("refresh_token", json!("")),
            ("refresh_token", json!("synthetic value")),
            ("expires_in", json!(0)),
            ("expires_in", json!(86_401)),
            ("token_type", json!("Basic")),
            ("scope", json!(format!("{READONLY_SCOPE} extra"))),
        ] {
            let mut value = valid.clone();
            value[field] = invalid;
            let response: TokenResponse = serde_json::from_value(value).expect("token response");
            let error = response
                .into_tokens(None)
                .err()
                .expect("invalid token rejected");
            let public = format!("{error:?}: {error}");
            assert!(!public.contains("synthetic"));
        }
        let mut refresh_response = valid.clone();
        refresh_response
            .as_object_mut()
            .expect("object")
            .remove("refresh_token");
        let response: TokenResponse =
            serde_json::from_value(refresh_response.clone()).expect("refresh response");
        let tokens = response
            .into_tokens(Some(Zeroizing::new("synthetic-previous-refresh".into())))
            .expect("refresh token retained");
        assert_eq!(tokens.refresh.as_str(), "synthetic-previous-refresh");
        let response: TokenResponse = serde_json::from_value(refresh_response).expect("response");
        assert!(matches!(
            response.into_tokens(None),
            Err(GmailError::ReconnectRequired)
        ));
        let response: TokenResponse = serde_json::from_value(valid).expect("valid");
        assert!(response.into_tokens(None).is_ok());
    }
}
