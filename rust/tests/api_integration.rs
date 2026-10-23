//! End-to-end integration tests for the Slop Grenade Axum HTTP/SSE API.

use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use serde_json::{json, Value};
use slop_grenade::event_bus::AnimationEventBus;
use slop_grenade::ledger::AwarenessLedger;
use slop_grenade::llm_luna::LunaClient;
use slop_grenade::scanner_daemon::ScannerDaemon;
use slop_grenade::server::{build_router, AppState};
use slop_grenade::slop_detector::AnimationTier;
use slop_grenade::workiq_mcp::WorkIqClient;

async fn spawn_test_server() -> String {
    let workiq = Arc::new(WorkIqClient::new(
        None,
        Some("test@contoso.com".to_string()),
    ));
    let luna = Arc::new(LunaClient::new(
        "https://api.githubcopilot.com/responses".to_string(),
        "gpt-5.6-luna".to_string(),
        false,
    ));
    let ledger = Arc::new(AwarenessLedger::new());
    let bus = Arc::new(AnimationEventBus::new());
    let daemon = Arc::new(ScannerDaemon::new(
        workiq.clone(),
        luna.clone(),
        ledger.clone(),
        bus.clone(),
    ));

    let state = AppState {
        daemon,
        workiq,
        luna,
        ledger,
        bus,
        web_asset_dir: PathBuf::from("../web/build"),
        sim_counter: Arc::new(AtomicU64::new(1)),
    };

    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn health_and_auth_endpoints_confirm_zero_service_tree_requirement() {
    let base = spawn_test_server().await;
    let client = reqwest::Client::new();

    let health: Value = client
        .get(format!("{base}/api/v1/health"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health["status"], "ok");
    assert_eq!(health["serviceTreeRequired"], false);
    assert_eq!(health["model"], "gpt-5.6-luna");

    let auth: Value = client
        .get(format!("{base}/api/v1/auth/status"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(auth["serviceTreeRequired"], false);
    assert_eq!(auth["githubLuna"]["model"], "gpt-5.6-luna");
    assert_eq!(auth["workiq"]["account"], "test@contoso.com");
}

#[tokio::test]
async fn simulate_and_analyze_endpoints_populate_ledger_and_recent_events() {
    let base = spawn_test_server().await;
    let client = reqwest::Client::new();

    // 1. Trigger all 5 tiers via /api/v1/simulate
    for (preset, expected_tier) in [
        ("human_sparkle", AnimationTier::HumanSparkle),
        ("peaceful_cloud", AnimationTier::PeacefulCloud),
        ("innocent_fruit", AnimationTier::InnocentFruit),
        ("slop_splat", AnimationTier::SlopSplat),
        ("slop_grenade", AnimationTier::SlopGrenade),
        ("my_outgoing_grenade", AnimationTier::SlopGrenade),
    ] {
        let resp: Value = client
            .post(format!("{base}/api/v1/simulate"))
            .json(&json!({ "preset": preset, "useLuna": false }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();

        let tier: AnimationTier = serde_json::from_value(resp["report"]["tier"].clone()).unwrap();
        assert_eq!(
            tier, expected_tier,
            "preset {preset} produced unexpected tier {tier:?}"
        );
        assert!(resp["event"]["sequence"].as_u64().unwrap() >= 1);
    }

    // 2. Verify ledger tracked both incoming and outgoing grenades
    let ledger: Value = client
        .get(format!("{base}/api/v1/ledger"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(ledger["receivedByMe"]["totalMessages"], 5);
    assert_eq!(ledger["receivedByMe"]["slopGrenades"], 1);
    assert_eq!(ledger["sentByMe"]["totalMessages"], 1);
    assert_eq!(ledger["sentByMe"]["slopGrenades"], 1);

    // 3. Verify /api/v1/analyze pre-send check works
    let custom: Value = client
        .post(format!("{base}/api/v1/analyze"))
        .json(&json!({
            "app": "teams",
            "direction": "sent",
            "sender": "Alex",
            "subjectOrTopic": "Sprint Demo",
            "body": "Hey team, demo link is ready—join when you have 5 mins!",
            "useLuna": false
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(custom["report"]["tier"], "human_sparkle");
    assert_eq!(custom["report"]["isSlopGrenade"], false);
}
