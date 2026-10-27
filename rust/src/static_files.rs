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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    #[test]
    fn sanitizes_relative_paths_and_maps_content_types() {
        assert_eq!(
            sanitize_relative_path("../../etc/passwd"),
            PathBuf::from("etc").join("passwd")
        );
        assert_eq!(sanitize_relative_path("../.."), PathBuf::from("index.html"));
        assert_eq!(
            content_type_for_path(Path::new("index.html")),
            "text/html; charset=utf-8"
        );
        assert_eq!(
            content_type_for_path(Path::new("app.js")),
            "application/javascript; charset=utf-8"
        );
        assert_eq!(
            content_type_for_path(Path::new("bundle.mjs")),
            "application/javascript; charset=utf-8"
        );
        assert_eq!(
            content_type_for_path(Path::new("styles.css")),
            "text/css; charset=utf-8"
        );
        assert_eq!(
            content_type_for_path(Path::new("manifest.json")),
            "application/json; charset=utf-8"
        );
        assert_eq!(
            content_type_for_path(Path::new("icon.svg")),
            "image/svg+xml"
        );
        assert_eq!(content_type_for_path(Path::new("logo.png")), "image/png");
        assert_eq!(
            content_type_for_path(Path::new("favicon.ico")),
            "image/x-icon"
        );
        assert_eq!(content_type_for_path(Path::new("font.woff2")), "font/woff2");
        assert_eq!(
            content_type_for_path(Path::new("archive.bin")),
            "application/octet-stream"
        );
    }

    #[tokio::test]
    async fn serves_assets_spa_index_and_missing_dir_fallback() {
        let missing_dir = std::env::temp_dir().join("slop-grenade-missing-assets-test");
        let root_uri: Uri = "/".parse().expect("valid uri");
        let fallback_resp = serve_static_or_spa(&missing_dir, &root_uri).await;
        assert_eq!(fallback_resp.status(), StatusCode::OK);
        let fallback_bytes = to_bytes(fallback_resp.into_body(), usize::MAX)
            .await
            .expect("body");
        assert!(std::str::from_utf8(&fallback_bytes)
            .expect("utf8")
            .contains("Slop Grenade Daemon Running"));

        let temp_dir =
            std::env::temp_dir().join(format!("slop-grenade-static-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");
        std::fs::write(temp_dir.join("index.html"), "<html>SPA Index</html>").expect("write index");
        std::fs::write(temp_dir.join("app.js"), "console.log('ok');").expect("write js");

        let index_resp = serve_static_or_spa(&temp_dir, &root_uri).await;
        assert_eq!(index_resp.status(), StatusCode::OK);
        let index_bytes = to_bytes(index_resp.into_body(), usize::MAX)
            .await
            .expect("body");
        assert_eq!(&index_bytes[..], b"<html>SPA Index</html>");

        let js_uri: Uri = "/app.js".parse().expect("valid uri");
        let js_resp = serve_static_or_spa(&temp_dir, &js_uri).await;
        assert_eq!(js_resp.status(), StatusCode::OK);
        assert_eq!(
            js_resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/javascript; charset=utf-8"
        );

        let spa_route_uri: Uri = "/dashboard/Nested".parse().expect("valid uri");
        let spa_resp = serve_static_or_spa(&temp_dir, &spa_route_uri).await;
        assert_eq!(spa_resp.status(), StatusCode::OK);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
