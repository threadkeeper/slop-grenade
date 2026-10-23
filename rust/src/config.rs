//! Runtime configuration for the Slop Grenade daemon.
//!
//! Reads environment variables with sensible local defaults so the standalone
//! daemon works out-of-the-box without requiring any admin app registration
//! or cloud provisioning.

use std::env;
use std::path::PathBuf;

/// Immutable runtime configuration for the Slop Grenade process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppConfig {
    /// Socket address (`host:port`) the HTTP/SSE server binds to.
    pub http_bind: String,
    /// Path to the built SvelteKit static assets directory (`web/build`).
    pub web_asset_dir: PathBuf,
    /// Poll interval in seconds for the background M365 WorkIQ scanner daemon.
    pub poll_interval_secs: u64,
    /// Whether automatic background polling of WorkIQ MCP is enabled on startup.
    pub auto_poll_enabled: bool,
    /// Whether live GitHub GPT Luna (`gpt-5.6-luna`) semantic scoring is enabled.
    pub luna_enabled: bool,
    /// Target model identifier for GitHub Copilot Responses API (`gpt-5.6-luna`).
    pub luna_model: String,
    /// Endpoint URL for the GitHub Copilot Responses API.
    pub luna_endpoint: String,
    /// Optional explicit path to the `workiq` executable.
    pub workiq_bin: Option<PathBuf>,
    /// Optional M365 account email passed to `workiq --account <email>`.
    pub workiq_account: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            http_bind: "127.0.0.1:8090".to_string(),
            web_asset_dir: PathBuf::from("../web/build"),
            poll_interval_secs: 60,
            auto_poll_enabled: true,
            luna_enabled: true,
            luna_model: "gpt-5.6-luna".to_string(),
            luna_endpoint: "https://api.githubcopilot.com/responses".to_string(),
            workiq_bin: None,
            workiq_account: None,
        }
    }
}

impl AppConfig {
    /// Load configuration from environment variables with fallback to [`Self::default`].
    pub fn from_env() -> Self {
        let defaults = Self::default();
        let http_bind = env::var("HTTP_BIND")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or(defaults.http_bind);

        let web_asset_dir = env::var("WEB_ASSET_DIR")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                let candidate = PathBuf::from("web/build");
                if candidate.exists() {
                    candidate
                } else {
                    defaults.web_asset_dir
                }
            });

        let poll_interval_secs = env::var("SLOP_POLL_INTERVAL_SECS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|&v| v >= 5)
            .unwrap_or(defaults.poll_interval_secs);

        let auto_poll_enabled = env::var("SLOP_AUTO_POLL")
            .ok()
            .map(|v| !matches!(v.trim().to_ascii_lowercase().as_str(), "0" | "false" | "no"))
            .unwrap_or(defaults.auto_poll_enabled);

        let luna_enabled = env::var("SLOP_LUNA_ENABLED")
            .ok()
            .map(|v| !matches!(v.trim().to_ascii_lowercase().as_str(), "0" | "false" | "no"))
            .unwrap_or(defaults.luna_enabled);

        let luna_model = env::var("SLOP_LUNA_MODEL")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or(defaults.luna_model);

        let luna_endpoint = env::var("SLOP_LUNA_ENDPOINT")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or(defaults.luna_endpoint);

        let workiq_bin = env::var("WORKIQ_BIN")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .map(PathBuf::from);

        let workiq_account = env::var("WORKIQ_ACCOUNT")
            .ok()
            .filter(|v| !v.trim().is_empty());

        Self {
            http_bind,
            web_asset_dir,
            poll_interval_secs,
            auto_poll_enabled,
            luna_enabled,
            luna_model,
            luna_endpoint,
            workiq_bin,
            workiq_account,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_uses_gpt_5_6_luna_and_port_8090() {
        let cfg = AppConfig::default();
        assert_eq!(cfg.http_bind, "127.0.0.1:8090");
        assert_eq!(cfg.luna_model, "gpt-5.6-luna");
        assert_eq!(cfg.luna_endpoint, "https://api.githubcopilot.com/responses");
        assert!(cfg.luna_enabled);
    }
}
