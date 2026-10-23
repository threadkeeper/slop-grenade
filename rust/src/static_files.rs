//! Static file serving for the compiled Svelte 5 (`web/build`) frontend.
//!
//! Serves HTML, JavaScript, CSS, SVG, and static assets from the configured
//! `web_asset_dir`, falling back to `index.html` for SPA routes (`/` and
//! `/?mode=overlay`).

use std::path::{Component, Path, PathBuf};

use axum::body::Body;
use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};

/// Serve a request path from `asset_dir`, falling back to `index.html`.
pub async fn serve_static_or_spa(asset_dir: &Path, uri: &Uri) -> Response {
    let raw_path = uri.path().trim_start_matches('/');
    let rel_path = if raw_path.is_empty() {
        PathBuf::from("index.html")
    } else {
        sanitize_relative_path(raw_path)
    };

    let candidate = asset_dir.join(&rel_path);
    let target = if candidate.is_file() {
        candidate
    } else {
        asset_dir.join("index.html")
    };

    match tokio::fs::read(&target).await {
        Ok(bytes) => {
            let mime = content_type_for_path(&target);
            (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, mime),
                    (header::CACHE_CONTROL, "no-cache"),
                ],
                Body::from(bytes),
            )
                .into_response()
        }
        Err(_) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            Body::from(FALLBACK_HTML),
        )
            .into_response(),
    }
}

fn sanitize_relative_path(raw: &str) -> PathBuf {
    let mut clean = PathBuf::new();
    for comp in Path::new(raw).components() {
        if let Component::Normal(segment) = comp {
            clean.push(segment);
        }
    }
    if clean.as_os_str().is_empty() {
        PathBuf::from("index.html")
    } else {
        clean
    }
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

const FALLBACK_HTML: &str = r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Slop Grenade Daemon</title>
</head>
<body style="background:#0b0f17;color:#e2e8f0;font-family:system-ui;padding:2rem;">
  <h1>Slop Grenade Daemon Running</h1>
  <p>Run <code>npm --prefix web run build</code> to build the Svelte 5 overlay and dashboard.</p>
</body>
</html>"#;
