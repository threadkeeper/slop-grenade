//! Standalone User-Auth GitHub account authentication and GPT Luna (`gpt-5.6-luna`) client.
//!
//! Resolves the user's GitHub credential from an in-memory session token,
//! `GITHUB_TOKEN`, or `gh auth token` and calls the GitHub Copilot Responses API
//! (`POST https://api.githubcopilot.com/responses`) with `model: "gpt-5.6-luna"`.

use std::env;
use std::process::Stdio;
use std::sync::RwLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::process::Command;

use crate::slop_detector::{LunaJudgment, MessageDirection, MessageSample};

/// Timeout for a single GPT Luna semantic evaluation request.
const LUNA_HTTP_TIMEOUT: Duration = Duration::from_secs(20);

/// Status of the user's GitHub authentication and GPT Luna inference readiness.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LunaAuthStatus {
    /// Whether a GitHub token is currently available (`gh auth token`, env, or session).
    pub authenticated: bool,
    /// Where the token was resolved from (`"session"`, `"env:GITHUB_TOKEN"`, `"gh_cli"`, or `"none"`).
    pub token_source: String,
    /// GitHub username if detected from `gh api user` or `gh auth status`.
    pub github_login: Option<String>,
    /// Target model (`gpt-5.6-luna`).
    pub model: String,
    /// Target Responses API endpoint.
    pub endpoint: String,
    /// Whether live GPT Luna inference is enabled.
    pub enabled: bool,
    /// Human-readable status summary.
    pub message: String,
}

/// Client for calling GPT Luna (`gpt-5.6-luna`) using the user's GitHub account.
pub struct LunaClient {
    endpoint: String,
    model: String,
    enabled: RwLock<bool>,
    session_token: RwLock<Option<String>>,
    cached_login: RwLock<Option<String>>,
    http: reqwest::Client,
}

impl LunaClient {
    /// Construct a new [`LunaClient`] targeting the configured endpoint and model (`gpt-5.6-luna`).
    pub fn new(endpoint: String, model: String, enabled: bool) -> Self {
        let http = reqwest::Client::builder()
            .timeout(LUNA_HTTP_TIMEOUT)
            .build()
            .unwrap_or_default();
        Self {
            endpoint,
            model,
            enabled: RwLock::new(enabled),
            session_token: RwLock::new(None),
            cached_login: RwLock::new(None),
            http,
        }
    }

    /// Store or clear a user-supplied GitHub token in memory (never written to disk).
    pub fn set_session_token(&self, token: Option<String>) {
        if let Ok(mut guard) = self.session_token.write() {
            *guard = token
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty());
        }
    }

    /// Enable or disable live GPT Luna semantic scoring at runtime.
    pub fn set_enabled(&self, enabled: bool) {
        if let Ok(mut guard) = self.enabled.write() {
            *guard = enabled;
        }
    }

    /// Whether GPT Luna inference is currently enabled.
    pub fn is_enabled(&self) -> bool {
        self.enabled.read().map(|g| *g).unwrap_or(true)
    }

    /// Check GitHub authentication readiness and return a [`LunaAuthStatus`] snapshot.
    pub async fn check_status(&self) -> LunaAuthStatus {
        let enabled = self.is_enabled();
        let (token_opt, source) = self.resolve_token().await;
        let github_login = if token_opt.is_some() {
            self.resolve_github_login().await
        } else {
            None
        };

        let authenticated = token_opt.is_some();
        let message = if authenticated {
            format!(
                "Authenticated to GitHub ({}) via {source} for {} inference.",
                github_login.as_deref().unwrap_or("active account"),
                self.model
            )
        } else {
            "No GitHub token found. Run `gh auth login` or paste a GitHub token in the Auth panel."
                .to_string()
        };

        LunaAuthStatus {
            authenticated,
            token_source: source,
            github_login,
            model: self.model.clone(),
            endpoint: self.endpoint.clone(),
            enabled,
            message,
        }
    }

    /// Evaluate a [`MessageSample`] with GPT Luna (`gpt-5.6-luna`) via the GitHub Copilot Responses API.
    pub async fn evaluate_message(&self, sample: &MessageSample) -> Result<LunaJudgment, String> {
        if !self.is_enabled() {
            return Err("GPT Luna evaluation is disabled".to_string());
        }
        let (Some(token), _) = self.resolve_token().await else {
            return Err("No GitHub token available for GPT Luna inference".to_string());
        };

        let prompt = build_luna_evaluation_prompt(sample);
        let request_body = build_responses_api_payload(&self.model, &prompt);

        let response = self
            .http
            .post(&self.endpoint)
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/json")
            .header("User-Agent", "slop-grenade")
            .header("Copilot-Integration-Id", "vscode-chat")
            .header("Editor-Version", "vscode/1.100.0")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("GPT Luna request failed: {e}"))?;

        let status = response.status();
        let body_text = response
            .text()
            .await
            .map_err(|e| format!("Failed reading GPT Luna response: {e}"))?;

        if !status.is_success() {
            return Err(format!("GPT Luna returned HTTP {status}: {body_text}"));
        }

        let response_json: Value = serde_json::from_str(&body_text)
            .map_err(|e| format!("Invalid JSON envelope from GPT Luna: {e}"))?;

        parse_luna_responses_envelope(&response_json, &self.model)
    }

    async fn resolve_token(&self) -> (Option<String>, String) {
        if let Ok(guard) = self.session_token.read() {
            if let Some(ref t) = *guard {
                return (Some(t.clone()), "session".to_string());
            }
        }
        if let Ok(env_tok) = env::var("GITHUB_TOKEN") {
            let trimmed = env_tok.trim();
            if !trimmed.is_empty() {
                return (Some(trimmed.to_string()), "env:GITHUB_TOKEN".to_string());
            }
        }

        let mut cmd = Command::new("gh");
        cmd.args(["auth", "token"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        if let Ok(Ok(out)) = tokio::time::timeout(Duration::from_secs(5), cmd.output()).await {
            if out.status.success() {
                let tok = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !tok.is_empty() {
                    return (Some(tok), "gh_cli".to_string());
                }
            }
        }

        (None, "none".to_string())
    }

    async fn resolve_github_login(&self) -> Option<String> {
        if let Ok(guard) = self.cached_login.read() {
            if guard.is_some() {
                return guard.clone();
            }
        }
        let mut cmd = Command::new("gh");
        cmd.args(["api", "user", "--jq", ".login"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        if let Ok(Ok(out)) = tokio::time::timeout(Duration::from_secs(5), cmd.output()).await {
            if out.status.success() {
                let login = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !login.is_empty() {
                    if let Ok(mut guard) = self.cached_login.write() {
                        *guard = Some(login.clone());
                    }
                    return Some(login);
                }
            }
        }
        None
    }
}

/// Build the request body for `POST https://api.githubcopilot.com/responses`.
pub fn build_responses_api_payload(model: &str, prompt: &str) -> Value {
    json!({
        "model": model,
        "input": prompt
    })
}

/// Construct the bounded evaluation prompt sent to GPT Luna (`gpt-5.6-luna`).
pub fn build_luna_evaluation_prompt(sample: &MessageSample) -> String {
    let dir_str = match sample.direction {
        MessageDirection::Received => "received from a colleague",
        MessageDirection::Sent => "authored/sent by the user themselves",
    };
    let truncated_body: String = sample.body.chars().take(1800).collect();

    format!(
        "You are the Slop Grenade detector evaluating a Microsoft 365 {:?} message ({dir_str}).\n\
         Score the message from 0 to 100 for how much of it was written by AI. Be strict: \
         modern assistants write clean, friendly business prose, so polish is evidence of AI, \
         not of care. Stock phrases (\"I hope you're doing well\", \"Let me know if you have \
         any questions\", \"Would you like me to\"), em dashes, tidy bullet lists, bold labels, \
         emoji checklists and evenly sized sentences all point to AI. Typos, lower-case starts, \
         slang, missing full stops and terse fragments point to a human.\n\
         - 0..19: Authentic human-typed message (natural cadence, concise, specific).\n\
         - 20..39: Human-written but lightly polished (peaceful cloud).\n\
         - 40..59: AI-assisted: drafted or rewritten with AI, lightly edited (innocent fruit).\n\
         - 60..79: Mostly AI-written, stock phrasing and padding (slop splat).\n\
         - 80..100: SLOP GRENADE! Unedited AI dump, symmetrical `- **Heading:**` bullet wall, or passive handoff shifting cognitive load onto readers.\n\n\
         Return ONLY a single compact JSON object with keys:\n\
         {{\"slopScore\": <0-100 integer>, \"reasoning\": \"<under 120 chars>\", \"coachingTip\": \"<under 160 chars>\"}}\n\n\
         Subject/Topic: {}\n\
         Message Body:\n{}",
        sample.app, sample.subject_or_topic, truncated_body
    )
}

/// Parse the `/responses` JSON envelope returned by `api.githubcopilot.com/responses`.
pub fn parse_luna_responses_envelope(
    envelope: &Value,
    default_model: &str,
) -> Result<LunaJudgment, String> {
    let model = envelope
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or(default_model)
        .to_string();

    let mut extracted_text = String::new();
    if let Some(output_arr) = envelope.get("output").and_then(Value::as_array) {
        for item in output_arr {
            if let Some(content_arr) = item.get("content").and_then(Value::as_array) {
                for c in content_arr {
                    if let Some(t) = c.get("text").and_then(Value::as_str) {
                        extracted_text.push_str(t);
                    }
                }
            }
        }
    }
    if extracted_text.is_empty() {
        if let Some(choice_text) = envelope
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
        {
            extracted_text.push_str(choice_text);
        }
    }

    if extracted_text.trim().is_empty() {
        return Err("GPT Luna response contained no output text".to_string());
    }

    let json_slice = extract_json_object_str(&extracted_text).ok_or_else(|| {
        format!("GPT Luna output did not contain a JSON object: {extracted_text}")
    })?;

    let parsed: Value = serde_json::from_str(json_slice)
        .map_err(|e| format!("Failed parsing GPT Luna JSON object: {e}"))?;

    let slop_score = parsed
        .get("slopScore")
        .or_else(|| parsed.get("slop_score"))
        .and_then(Value::as_u64)
        .unwrap_or(0)
        .min(100) as u8;

    let reasoning = parsed
        .get("reasoning")
        .and_then(Value::as_str)
        .unwrap_or("Evaluated by GPT Luna")
        .to_string();

    let coaching_tip = parsed
        .get("coachingTip")
        .or_else(|| parsed.get("coaching_tip"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    Ok(LunaJudgment {
        slop_score,
        model,
        reasoning,
        coaching_tip,
    })
}

fn extract_json_object_str(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    if end >= start {
        Some(&raw[start..=end])
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_responses_api_envelope_from_gpt_5_6_luna() {
        let envelope = json!({
            "id": "resp_123",
            "model": "gpt-5.6-luna",
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "```json\n{\"slopScore\": 89, \"reasoning\": \"Unedited bold bullet wall in Teams\", \"coachingTip\": \"Summarize in 2 plain sentences.\"}\n```"
                        }
                    ]
                }
            ]
        });

        let judgment = parse_luna_responses_envelope(&envelope, "gpt-5.6-luna").unwrap();
        assert_eq!(judgment.slop_score, 89);
        assert_eq!(judgment.model, "gpt-5.6-luna");
        assert_eq!(judgment.reasoning, "Unedited bold bullet wall in Teams");
        assert_eq!(judgment.coaching_tip, "Summarize in 2 plain sentences.");
    }

    #[test]
    fn prompt_includes_direction_and_five_tier_rubric() {
        let sample = MessageSample {
            message_id: "m1".to_string(),
            app: crate::slop_detector::M365App::Teams,
            direction: MessageDirection::Sent,
            sender: "Alex".to_string(),
            subject_or_topic: "Design Sync".to_string(),
            body: "Quick update on the build.".to_string(),
            timestamp: "2026-10-23T14:00:00Z".to_string(),
        };
        let prompt = build_luna_evaluation_prompt(&sample);
        assert!(prompt.contains("authored/sent by the user themselves"));
        assert!(prompt.contains("80..100: SLOP GRENADE!"));
    }
}
