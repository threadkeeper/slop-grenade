//! End-to-end integration tests for the Slop Grenade Axum HTTP/SSE API.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use slop_grenade::config::AppConfig;
use slop_grenade::event_bus::AnimationEventBus;
use slop_grenade::gmail_scanner::GmailScanner;
use slop_grenade::ledger::AwarenessLedger;
use slop_grenade::llm_luna::LunaClient;
use slop_grenade::scanner_daemon::ScannerDaemon;
use slop_grenade::server::{build_router, AppState};
use slop_grenade::slop_detector::AnimationTier;
use slop_grenade::workiq_mcp::WorkIqClient;

async fn spawn_test_server() -> String {
    spawn_gmail_test_server(None, None).await
}

async fn spawn_gmail_test_server(
    client_id: Option<&str>,
    peer_override: Option<std::net::SocketAddr>,
) -> String {
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
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let config = AppConfig {
        gmail_oauth_client_id: client_id.map(str::to_string),
        ..AppConfig::default()
    };
    let gmail = Arc::new(
        GmailScanner::new(
            &config,
            format!("http://{addr}/api/v1/auth/google/callback"),
            ledger.clone(),
            bus.clone(),
        )
        .unwrap(),
    );
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
        gmail,
        web_asset_dir: PathBuf::from("../web/build"),
        sim_counter: Arc::new(AtomicU64::new(1)),
    };

    let mut app = build_router(state);
    if let Some(peer) = peer_override {
        app = app.layer(axum::Extension(axum::extract::ConnectInfo(peer)));
    }
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn gmail_status_is_part_of_combined_auth_and_requires_configuration() {
    let base = spawn_test_server().await;
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{base}/api/v1/auth/status"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.headers()["cache-control"], "no-store");
    let status: Value = response.json().await.unwrap();
    assert_eq!(status["adminAppRequired"], false);
    assert!(status["workiq"].is_object());
    assert_eq!(status["workiq"]["authenticated"], false);
    assert!(status["githubLuna"].is_object());
    assert_eq!(status["gmail"]["configured"], false);
    assert_eq!(status["gmail"]["accounts"], json!([]));

    let analyzed: Value = client
        .post(format!("{base}/api/v1/analyze"))
        .json(&json!({ "body": "Synthetic communication for wipe verification." }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(analyzed["report"]["messageId"].is_string());

    let sign_out = client
        .post(format!("{base}/api/v1/auth/workiq-logout"))
        .send()
        .await
        .unwrap();
    assert_eq!(sign_out.status(), reqwest::StatusCode::BAD_GATEWAY);
    let failure: Value = sign_out.json().await.unwrap();
    assert_eq!(failure["ok"], false);
    assert_eq!(failure["dataWiped"], true);
    assert_eq!(failure["resetGeneration"], 1);
    assert!(failure["error"].as_str().is_some_and(|message| {
        message == "WorkIQ binary not found on this machine."
            || message == "Could not start WorkIQ sign-out."
            || message == "WorkIQ could not complete Microsoft 365 sign-out."
    }));
    let ledger: Value = client
        .get(format!("{base}/api/v1/ledger"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(ledger["recentReports"], json!([]));
    assert_eq!(ledger["resetGeneration"], 1);
    let response = client
        .post(format!("{base}/api/v1/gmail/authorize"))
        .bearer_auth("synthetic-dashboard-bearer")
        .send()
        .await
        .unwrap();
    assert!(!response.status().is_success());
    let body = response.text().await.unwrap();
    assert!(!body.contains("authorizationUrl"));
    assert!(!body.contains("client_secret"));
}

#[tokio::test]
async fn sse_reconnect_synchronizes_reset_after_more_than_a_queue_of_new_events() {
    let base = spawn_test_server().await;
    let client = reqwest::Client::new();
    let wipe: Value = client
        .post(format!("{base}/api/v1/auth/workiq-logout"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(wipe["dataWiped"], true);
    assert_eq!(wipe["resetGeneration"], 1);
    for _ in 0..40 {
        let response: Value = client
            .post(format!("{base}/api/v1/simulate"))
            .json(&json!({ "preset": "human_sparkle" }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(response["event"]["resetGeneration"], 1);
    }
    for _ in 0..2 {
        let mut response = client
            .get(format!("{base}/api/v1/events/stream"))
            .send()
            .await
            .unwrap();
        let frame = tokio::time::timeout(Duration::from_secs(2), async {
            let mut frame = String::new();
            while !frame.contains("\n\n") {
                frame.push_str(
                    std::str::from_utf8(&response.chunk().await.unwrap().expect("SSE marker"))
                        .unwrap(),
                );
            }
            frame
        })
        .await
        .expect("reset must be sent without waiting for another live event");
        let event: Value = serde_json::from_str(
            frame
                .lines()
                .find_map(|line| line.strip_prefix("data: "))
                .expect("SSE data"),
        )
        .unwrap();
        assert_eq!(event["dataWiped"], true);
        assert_eq!(event["resetGeneration"], 1);
    }
    let ledger: Value = client
        .get(format!("{base}/api/v1/ledger"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(ledger["resetGeneration"], 1);
    assert_eq!(ledger["recentReports"].as_array().unwrap().len(), 40);
}

#[tokio::test]
async fn gmail_routes_reject_remote_peers_rebinding_and_android_origins() {
    let remote = spawn_gmail_test_server(
        Some("synthetic-desktop-client"),
        Some("192.0.2.1:32100".parse().unwrap()),
    )
    .await;
    let local = spawn_gmail_test_server(Some("synthetic-desktop-client"), None).await;
    let client = reqwest::Client::new();
    for path in [
        "/api/v1/gmail/accounts",
        "/api/v1/gmail/events",
        "/api/v1/auth/google/callback?state=synthetic-state&code=synthetic-code",
    ] {
        assert_eq!(
            client
                .get(format!("{remote}{path}"))
                .send()
                .await
                .unwrap()
                .status(),
            reqwest::StatusCode::FORBIDDEN
        );
    }
    for path in [
        "/api/v1/gmail/authorize",
        "/api/v1/gmail/scan",
        "/api/v1/gmail/accounts/synthetic-account/reconnect",
    ] {
        assert_eq!(
            client
                .post(format!("{remote}{path}"))
                .send()
                .await
                .unwrap()
                .status(),
            reqwest::StatusCode::FORBIDDEN
        );
    }
    assert_eq!(
        client
            .delete(format!("{remote}/api/v1/gmail/accounts/synthetic-account"))
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::FORBIDDEN
    );
    for (name, value) in [
        ("Host", "attacker.invalid:8090"),
        ("Origin", "https://appassets.androidplatform.net"),
        ("Origin", "https://attacker.invalid"),
    ] {
        assert_eq!(
            client
                .post(format!("{local}/api/v1/gmail/authorize"))
                .header(name, value)
                .send()
                .await
                .unwrap()
                .status(),
            reqwest::StatusCode::FORBIDDEN
        );
    }
    for (base, headers) in [
        (&remote, vec![]),
        (
            &local,
            vec![
                ("Host", "attacker.invalid:8090"),
                ("Origin", "http://attacker.invalid:8090"),
            ],
        ),
        (
            &local,
            vec![("Origin", "https://appassets.androidplatform.net")],
        ),
    ] {
        let mut request = client.get(format!("{base}/api/v1/auth/status"));
        for (name, value) in headers {
            request = request.header(name, value);
        }
        let status: Value = request.send().await.unwrap().json().await.unwrap();
        assert!(status.get("gmail").is_none());
        assert!(status["workiq"].is_object());
        assert!(status["githubLuna"].is_object());
    }
}

#[tokio::test]
async fn gmail_authorization_is_single_use_readonly_and_redacts_callback_failures() {
    let base = spawn_gmail_test_server(Some("synthetic-desktop-client"), None).await;
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{base}/api/v1/gmail/authorize"))
        .bearer_auth("synthetic-dashboard-bearer")
        .send()
        .await
        .unwrap();
    assert_eq!(response.headers()["cache-control"], "no-store");
    let authorization: Value = response.json().await.unwrap();
    assert!(!authorization
        .to_string()
        .contains("synthetic-dashboard-bearer"));
    let url = reqwest::Url::parse(authorization["authorizationUrl"].as_str().unwrap()).unwrap();
    let parameters: std::collections::HashMap<_, _> = url.query_pairs().collect();
    assert_eq!(
        parameters["scope"],
        "https://www.googleapis.com/auth/gmail.readonly"
    );
    assert_eq!(parameters["code_challenge_method"], "S256");
    assert_eq!(
        parameters["redirect_uri"],
        format!("{base}/api/v1/auth/google/callback")
    );
    assert!(!parameters.contains_key("client_secret"));
    assert!(!parameters.contains_key("code_verifier"));
    assert_eq!(
        client
            .post(format!("{base}/api/v1/gmail/authorize"))
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::CONFLICT
    );
    let response = client
        .get(format!("{base}/api/v1/auth/google/callback"))
        .query(&[
            ("state", parameters["state"].as_ref()),
            ("error", "access_denied"),
        ])
        .send()
        .await
        .unwrap();
    assert!(!response.status().is_success());
    assert_eq!(response.headers()["cache-control"], "no-store");
    let html = response.text().await.unwrap();
    assert!(!html.contains(parameters["state"].as_ref()));
    assert!(!html.contains("access_denied"));
    let response = client
        .get(format!("{base}/api/v1/auth/google/callback"))
        .query(&[
            ("state", parameters["state"].as_ref()),
            ("code", "synthetic-code"),
        ])
        .send()
        .await
        .unwrap();
    assert!(!response.status().is_success());
    assert!(!response.text().await.unwrap().contains("synthetic-code"));
    for query in [
        "code=synthetic-code",
        "state=wrong&code=synthetic-code",
        "state=a&state=b&code=synthetic-code",
    ] {
        let response = client
            .get(format!("{base}/api/v1/auth/google/callback?{query}"))
            .send()
            .await
            .unwrap();
        assert!(!response.status().is_success());
        assert!(!response.text().await.unwrap().contains("synthetic-code"));
    }
    let status: Value = client
        .get(format!("{base}/api/v1/gmail/accounts"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["accounts"], json!([]));
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
async fn desktop_daemon_refuses_public_bind_addresses() {
    let output = tokio::process::Command::new(env!("CARGO_BIN_EXE_slop-grenade"))
        .env("HTTP_BIND", "0.0.0.0:0")
        .env("SLOP_AUTO_POLL", "false")
        .env("SLOP_LUNA_ENABLED", "false")
        .kill_on_drop(true)
        .output()
        .await
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("loopback only"));
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
