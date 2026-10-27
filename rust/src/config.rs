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
    /// Background WorkIQ poll interval in seconds (default and minimum: three).
    pub poll_interval_secs: u64,
    /// Whether automatic background polling of WorkIQ MCP is enabled on startup.
    pub auto_poll_enabled: bool,
    /// Whether to seed synthetic dashboard history; disabled for normal real-account use.
    pub demo_data_enabled: bool,
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
            poll_interval_secs: 3,
            auto_poll_enabled: true,
            demo_data_enabled: false,
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
            .filter(|&v| v >= 3)
            .unwrap_or(defaults.poll_interval_secs);

        let auto_poll_enabled = env::var("SLOP_AUTO_POLL")
            .ok()
            .map(|v| !matches!(v.trim().to_ascii_lowercase().as_str(), "0" | "false" | "no"))
            .unwrap_or(defaults.auto_poll_enabled);

        let demo_data_enabled = env::var("SLOP_DEMO_DATA")
            .ok()
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(defaults.demo_data_enabled);

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
            demo_data_enabled,
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
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn default_config_uses_gpt_5_6_luna_and_port_8090() {
        let cfg = AppConfig::default();
        assert_eq!(cfg.http_bind, "127.0.0.1:8090");
        assert_eq!(cfg.poll_interval_secs, 3);
        assert_eq!(cfg.luna_model, "gpt-5.6-luna");
        assert_eq!(cfg.luna_endpoint, "https://api.githubcopilot.com/responses");
        assert!(cfg.luna_enabled);
        assert!(!cfg.demo_data_enabled);
    }

    #[test]
    fn from_env_reads_overrides_and_falls_back_cleanly() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let vars = [
            "HTTP_BIND",
            "WEB_ASSET_DIR",
            "SLOP_POLL_INTERVAL_SECS",
            "SLOP_AUTO_POLL",
            "SLOP_DEMO_DATA",
            "SLOP_LUNA_ENABLED",
            "SLOP_LUNA_MODEL",
            "SLOP_LUNA_ENDPOINT",
            "WORKIQ_BIN",
            "WORKIQ_ACCOUNT",
        ];
        for key in vars {
            env::remove_var(key);
        }

        let fallback = AppConfig::from_env();
        assert_eq!(fallback.http_bind, "127.0.0.1:8090");
        assert_eq!(fallback.poll_interval_secs, 3);
        assert!(fallback.auto_poll_enabled);
        assert!(!fallback.demo_data_enabled);
        assert!(fallback.luna_enabled);
        assert!(fallback.workiq_bin.is_none());
        assert!(fallback.workiq_account.is_none());

        env::set_var("HTTP_BIND", "127.0.0.1:9099");
        env::set_var("WEB_ASSET_DIR", "custom/web/build");
        env::set_var("SLOP_POLL_INTERVAL_SECS", "15");
        env::set_var("SLOP_AUTO_POLL", "false");
        env::set_var("SLOP_DEMO_DATA", "true");
        env::set_var("SLOP_LUNA_ENABLED", "0");
        env::set_var("SLOP_LUNA_MODEL", "gpt-5.6-luna-custom");
        env::set_var("SLOP_LUNA_ENDPOINT", "https://example.test/responses");
        env::set_var("WORKIQ_BIN", "/usr/local/bin/workiq");
        env::set_var("WORKIQ_ACCOUNT", "alex@contoso.com");

        let custom = AppConfig::from_env();
        assert_eq!(custom.http_bind, "127.0.0.1:9099");
        assert_eq!(custom.web_asset_dir, PathBuf::from("custom/web/build"));
        assert_eq!(custom.poll_interval_secs, 15);
        assert!(!custom.auto_poll_enabled);
        assert!(custom.demo_data_enabled);
        assert!(!custom.luna_enabled);
        assert_eq!(custom.luna_model, "gpt-5.6-luna-custom");
        assert_eq!(custom.luna_endpoint, "https://example.test/responses");
        assert_eq!(
            custom.workiq_bin,
            Some(PathBuf::from("/usr/local/bin/workiq"))
        );
        assert_eq!(custom.workiq_account.as_deref(), Some("alex@contoso.com"));

        // Sub-3-second intervals clamp back to default (3 seconds).
        env::set_var("SLOP_POLL_INTERVAL_SECS", "1");
        assert_eq!(AppConfig::from_env().poll_interval_secs, 3);

        for key in vars {
            env::remove_var(key);
        }
    }
}
