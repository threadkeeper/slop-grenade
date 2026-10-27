//! End-to-end integration tests for the Slop Grenade Axum HTTP/SSE API.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use std::time::{Duration, Instant};

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
        // An existing non-executable fixture prevents tests from using real M365 credentials.
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")),
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

async fn startup_ledger(demo_data: Option<&str>) -> Value {
    let reservation = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = reservation.local_addr().unwrap();
    drop(reservation);

    let mut command = tokio::process::Command::new(env!("CARGO_BIN_EXE_slop-grenade"));
    command
        .env("HTTP_BIND", addr.to_string())
        .env("SLOP_AUTO_POLL", "false")
        .env("SLOP_LUNA_ENABLED", "false")
        .env_remove("SLOP_DEMO_DATA")
        .stdout(Stdio::null())
        .kill_on_drop(true);
    if let Some(value) = demo_data {
        command.env("SLOP_DEMO_DATA", value);
    }
    let mut child = command.spawn().unwrap();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap();
    let started = Instant::now();
    let ledger = loop {
        if let Some(status) = child.try_wait().unwrap() {
            panic!("Daemon exited before becoming ready: {status}");
        }
        if let Ok(response) = client
            .get(format!("http://{addr}/api/v1/ledger"))
            .send()
            .await
        {
            break response
                .error_for_status()
                .unwrap()
                .json::<Value>()
                .await
                .unwrap();
        }
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "Daemon did not become ready"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    };
    child.kill().await.unwrap();
    ledger
}

#[tokio::test]
async fn startup_ledger_is_empty_without_demo_opt_in() {
    for demo_data in [None, Some("0"), Some("false")] {
        let ledger = startup_ledger(demo_data).await;
        assert!(ledger["recentReports"].as_array().unwrap().is_empty());
        assert_eq!(ledger["receivedByMe"]["totalMessages"], 0);
        assert_eq!(ledger["sentByMe"]["totalMessages"], 0);
        assert!(ledger["topSloppers"].as_array().unwrap().is_empty());
        assert!(ledger["topPDoomers"].as_array().unwrap().is_empty());
    }
}

#[tokio::test]
async fn startup_demo_history_requires_explicit_opt_in() {
    for demo_data in ["1", "true", "yes"] {
        let ledger = startup_ledger(Some(demo_data)).await;
        assert!(!ledger["recentReports"].as_array().unwrap().is_empty());
    }
}

#[tokio::test]
async fn rejects_invalid_history_windows_and_remote_scoring_for_backfills() {
    let base = spawn_test_server().await;
    let client = reqwest::Client::new();
    for payload in [
        json!({ "lookbackDays": 0 }),
        json!({ "lookbackDays": 31 }),
        json!({ "lookbackDays": 7, "useLuna": true }),
        json!({ "lookbackDays": 30, "useLuna": true }),
    ] {
        let response = client
            .post(format!("{base}/api/v1/scan/now"))
            .json(&payload)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
        let body: Value = response.json().await.unwrap();
        assert_eq!(body["ok"], false);
        assert!(body["error"]
            .as_str()
            .is_some_and(|error| !error.is_empty()));
    }
}

#[tokio::test]
async fn history_accepts_every_window_from_one_to_thirty_days() {
    let base = spawn_test_server().await;
    let client = reqwest::Client::new();
    for days in 1..=30 {
        let response = client
            .post(format!("{base}/api/v1/scan/now"))
            .json(&json!({ "lookbackDays": days, "useLuna": false }))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        let body: Value = response.json().await.unwrap();
        assert_eq!(body["ok"], false);
        assert!(body["error"]
            .as_str()
            .is_some_and(|error| error.starts_with("WorkIQ identity lookup failed:")));
    }
}

#[tokio::test]
async fn refresh_progress_is_correlated_metadata_and_surfaces_a_failed_scan() {
    let base = spawn_test_server().await;
    let client = reqwest::Client::new();
    let endpoint = format!("{base}/api/v1/scan/progress?refreshId=fixture-refresh");
    let response = client.get(&endpoint).send().await.unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let before: Value = response.json().await.unwrap();
    assert_eq!(before, json!({ "progress": null }));

    let result: Value = client
        .post(format!("{base}/api/v1/scan/now"))
        .json(&json!({ "lookbackDays": 7, "useLuna": false, "refreshId": "fixture-refresh" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(result["ok"], false);
    let after: Value = client
        .get(&endpoint)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(after["progress"]["refreshId"], "fixture-refresh");
    assert_eq!(after["progress"]["lookbackDays"], 7);
    assert_eq!(after["progress"]["phase"], "failed");
    assert_eq!(after["progress"]["outlookScanned"], 0);
    assert_eq!(after["progress"]["outlookTotal"], Value::Null);
    assert_eq!(after["progress"]["teamsScanned"], 0);
    assert_eq!(after["progress"]["teamsTotal"], Value::Null);
    for forbidden in ["test@contoso.com", "reports", "body", "sender", "subject"] {
        assert!(!after.to_string().contains(forbidden));
    }
    let other: Value = client
        .get(format!(
            "{base}/api/v1/scan/progress?refreshId=another-refresh"
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(other, json!({ "progress": null }));
}

#[tokio::test]
async fn refresh_ids_require_a_history_window_and_a_bounded_opaque_identifier() {
    let base = spawn_test_server().await;
    let client = reqwest::Client::new();
    for payload in [
        json!({ "refreshId": "fixture-refresh" }),
        json!({ "lookbackDays": 7, "refreshId": "" }),
        json!({ "lookbackDays": 7, "refreshId": "x".repeat(65) }),
        json!({ "lookbackDays": 7, "refreshId": "private@example.invalid" }),
    ] {
        let response = client
            .post(format!("{base}/api/v1/scan/now"))
            .json(&payload)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
        let error: Value = response.json().await.unwrap();
        assert_eq!(error["ok"], false);
        assert!(!error.to_string().contains("private@example.invalid"));
    }
}

#[tokio::test]
async fn health_and_auth_endpoints_confirm_standalone_user_auth() {
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
    assert_eq!(health["adminAppRequired"], false);
    assert_eq!(health["model"], "gpt-5.6-luna");

    let auth: Value = client
        .get(format!("{base}/api/v1/auth/status"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(auth["adminAppRequired"], false);
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

#[tokio::test]
async fn enforces_browser_security_headers_and_rejects_foreign_origins() {
    let base = spawn_test_server().await;
    let client = reqwest::Client::new();

    // 1. Loopback origin gets explicit Access-Control-Allow-Origin + full security headers
    let ok_res = client
        .get(format!("{base}/api/v1/health"))
        .header("Origin", "http://127.0.0.1:8090")
        .send()
        .await
        .unwrap();
    assert_eq!(ok_res.status(), reqwest::StatusCode::OK);
    let headers = ok_res.headers();
    assert_eq!(
        headers
            .get("access-control-allow-origin")
            .and_then(|v| v.to_str().ok()),
        Some("http://127.0.0.1:8090")
    );
    assert_eq!(
        headers
            .get("x-content-type-options")
            .and_then(|v| v.to_str().ok()),
        Some("nosniff")
    );
    assert_eq!(
        headers.get("x-frame-options").and_then(|v| v.to_str().ok()),
        Some("DENY")
    );
    assert_eq!(
        headers.get("referrer-policy").and_then(|v| v.to_str().ok()),
        Some("no-referrer")
    );
    assert!(headers
        .get("permissions-policy")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("camera=()")));
    assert!(headers
        .get("content-security-policy")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("default-src 'self'") && v.contains("frame-ancestors 'none'")));

    // 2. Foreign origin GET does not receive Access-Control-Allow-Origin
    let foreign_get = client
        .get(format!("{base}/api/v1/ledger"))
        .header("Origin", "https://evil.example.com")
        .send()
        .await
        .unwrap();
    assert!(foreign_get
        .headers()
        .get("access-control-allow-origin")
        .is_none());

    // 3. Foreign origin POST is rejected with 403 Forbidden before mutating state
    let foreign_post = client
        .post(format!("{base}/api/v1/auth/github-token"))
        .header("Origin", "https://evil.example.com")
        .json(&json!({ "token": "gho_injected", "enabled": true }))
        .send()
        .await
        .unwrap();
    assert_eq!(foreign_post.status(), reqwest::StatusCode::FORBIDDEN);
}
