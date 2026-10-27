//! Unified Standalone User-Auth authentication coordinator.
//!
//! Combines the user's **WorkIQ MCP** status (M365 Teams & Outlook access via
//! first-party CLI broker) and **GitHub GPT Luna (`gpt-5.6-luna`)** status into
//! a single status contract alongside memory-only desktop Gmail status.

use serde::{Deserialize, Serialize};

use crate::gmail_scanner::GmailScanner;
use crate::llm_luna::{LunaAuthStatus, LunaClient};
use crate::workiq_mcp::{WorkIqClient, WorkIqStatus};

/// Combined Standalone User-Auth authentication snapshot returned by `GET /api/v1/auth/status`.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombinedAuthStatus {
    /// Always `false`: Slop Grenade never requires admin app or custom Entra app registration.
    pub admin_app_required: bool,
    /// WorkIQ MCP connection and authentication state.
    pub workiq: WorkIqStatus,
    /// GitHub account and GPT Luna (`gpt-5.6-luna`) inference state.
    pub github_luna: LunaAuthStatus,
    /// Sanitized Gmail status; account labels are ephemeral and must not be logged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gmail: Option<serde_json::Value>,
}

/// Coordinates WorkIQ MCP, GitHub GPT Luna, and process-local Gmail status.
pub struct AuthCoordinator;

impl AuthCoordinator {
    /// Gather a combined status for a trusted local caller without exposing credentials.
    pub async fn status(
        workiq: &WorkIqClient,
        luna: &LunaClient,
        gmail: &GmailScanner,
    ) -> CombinedAuthStatus {
        let (workiq_status, luna_status) = tokio::join!(workiq.check_status(), luna.check_status());
        CombinedAuthStatus {
            admin_app_required: false,
            workiq: workiq_status,
            github_luna: luna_status,
            gmail: Some(gmail.status().await),
        }
    }
}
