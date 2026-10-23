//! Unified zero-Service-Tree authentication coordinator.
//!
//! Combines the user's **WorkIQ MCP** status (M365 Teams & Outlook access via
//! first-party CLI broker) and **GitHub GPT Luna (`gpt-5.6-luna`)** status into
//! a single status contract for the UI and daemon.

use serde::{Deserialize, Serialize};

use crate::llm_luna::{LunaAuthStatus, LunaClient};
use crate::workiq_mcp::{WorkIqClient, WorkIqStatus};

/// Combined zero-Service-Tree authentication snapshot returned by `GET /api/v1/auth/status`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombinedAuthStatus {
    /// Always `false`: Slop Grenade never requires Service Tree or custom Entra app registration.
    pub service_tree_required: bool,
    /// WorkIQ MCP connection and authentication state.
    pub workiq: WorkIqStatus,
    /// GitHub account and GPT Luna (`gpt-5.6-luna`) inference state.
    pub github_luna: LunaAuthStatus,
}

/// Coordinates status checks and interactive authentication for WorkIQ MCP and GitHub GPT Luna.
pub struct AuthCoordinator;

impl AuthCoordinator {
    /// Gather the current [`CombinedAuthStatus`] from [`WorkIqClient`] and [`LunaClient`].
    pub async fn status(workiq: &WorkIqClient, luna: &LunaClient) -> CombinedAuthStatus {
        let (workiq_status, luna_status) = tokio::join!(workiq.check_status(), luna.check_status());
        CombinedAuthStatus {
            service_tree_required: false,
            workiq: workiq_status,
            github_luna: luna_status,
        }
    }
}
