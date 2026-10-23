//! Slop Grenade — Single orchestrating entrypoint.
//!
//! Wires together:
//! 1. Runtime configuration (`AppConfig::from_env`)
//! 2. Standalone User-Auth **WorkIQ MCP** client (`WorkIqClient`) for scanning
//!    Microsoft Teams and Outlook communications
//! 3. Standalone User-Auth **GitHub GPT Luna (`gpt-5.6-luna`)** client (`LunaClient`)
//!    for semantic slop evaluation via `https://api.githubcopilot.com/responses`
//! 4. In-memory **Self-Awareness Ledger** (`AwarenessLedger`) and **SSE Event Bus** (`AnimationEventBus`)
//! 5. Background M365 scanner daemon (`ScannerDaemon`)
//! 6. Axum HTTP + SSE server serving both the API and the Svelte 5 Monitor Overlay UI

use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use slop_grenade::config::AppConfig;
use slop_grenade::event_bus::AnimationEventBus;
use slop_grenade::ledger::AwarenessLedger;
use slop_grenade::llm_luna::LunaClient;
use slop_grenade::scanner_daemon::ScannerDaemon;
use slop_grenade::server::{build_router, AppState};
use slop_grenade::workiq_mcp::WorkIqClient;

#[tokio::main]
async fn main() {
    // 1. Load runtime configuration from environment with sensible local defaults.
    let config = AppConfig::from_env();

    // 2. Initialize Standalone User-Auth WorkIQ MCP client (discovers local `workiq` binary).
    let workiq = Arc::new(WorkIqClient::new(
        config.workiq_bin.clone(),
        config.workiq_account.clone(),
    ));

    // 3. Initialize Standalone User-Auth GitHub GPT Luna (`gpt-5.6-luna`) client.
    let luna = Arc::new(LunaClient::new(
        config.luna_endpoint.clone(),
        config.luna_model.clone(),
        config.luna_enabled,
    ));

    // 4. Create the in-memory Self-Awareness Ledger and SSE Animation Event Bus.
    let ledger = Arc::new(AwarenessLedger::new());
    ledger.seed_baseline_history();
    let bus = Arc::new(AnimationEventBus::new());

    // 5. Construct the M365 Scanner Daemon and start background WorkIQ polling if enabled.
    let daemon = Arc::new(ScannerDaemon::new(
        workiq.clone(),
        luna.clone(),
        ledger.clone(),
        bus.clone(),
    ));

    if config.auto_poll_enabled {
        daemon
            .clone()
            .spawn_background_loop(config.poll_interval_secs);
    }

    // 6. Build the Axum HTTP/SSE router and bind the listener.
    let state = AppState {
        daemon,
        workiq,
        luna,
        ledger,
        bus,
        web_asset_dir: config.web_asset_dir.clone(),
        sim_counter: Arc::new(AtomicU64::new(1)),
    };

    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(&config.http_bind)
        .await
        .unwrap_or_else(|err| {
            panic!(
                "Failed to bind Slop Grenade HTTP listener on {}: {err}",
                config.http_bind
            )
        });

    println!("================================================================");
    println!("  SLOP GRENADE DAEMON RUNNING");
    println!("  Dashboard & Self-Check : http://{}/", config.http_bind);
    println!(
        "  Monitor Edge Overlay   : http://{}/?mode=overlay",
        config.http_bind
    );
    println!("  GPT Luna Model         : {}", config.luna_model);
    println!("  admin app Required  : false (WorkIQ MCP + GitHub Auth)");
    println!("================================================================");

    axum::serve(listener, app)
        .await
        .unwrap_or_else(|err| panic!("Slop Grenade HTTP server error: {err}"));
}
