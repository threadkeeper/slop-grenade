#!/usr/bin/env bash
# install-macos.sh
# Installs or builds Slop Grenade on macOS (Apple Silicon & Intel Universal),
# registers a LaunchAgent so it starts automatically on login, and launches the
# native macOS Menu Bar + Desktop Screen Overlay app.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DEST_DIR="$HOME/Applications"
APP_BUNDLE="$APP_DEST_DIR/Slop Grenade.app"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCH_AGENTS_DIR/com.threadkeeper.slop-grenade.plist"

mkdir -p "$APP_DEST_DIR" "$LAUNCH_AGENTS_DIR"

# Stop any running Slop Grenade instances before updating binaries
pkill -f "slop-grenade-overlay" >/dev/null 2>&1 || true
pkill -f "slop-grenade" >/dev/null 2>&1 || true

if [[ -d "$SCRIPT_DIR/Slop Grenade.app" ]]; then
  echo "==> Installing prebuilt Slop Grenade.app into $APP_BUNDLE..."
  rm -rf "$APP_BUNDLE"
  cp -R "$SCRIPT_DIR/Slop Grenade.app" "$APP_BUNDLE"
elif [[ -d "$REPO_ROOT/Slop Grenade.app" ]]; then
  echo "==> Installing prebuilt Slop Grenade.app into $APP_BUNDLE..."
  rm -rf "$APP_BUNDLE"
  cp -R "$REPO_ROOT/Slop Grenade.app" "$APP_BUNDLE"
else
  echo "==> [1/3] Building Svelte 5 Web Dashboard..."
  npm --prefix "$REPO_ROOT/web" ci
  npm --prefix "$REPO_ROOT/web" run build

  echo "==> [2/3] Building Release Rust Background Daemon (slop-grenade)..."
  cargo build --locked --manifest-path "$REPO_ROOT/rust/Cargo.toml" --release

  echo "==> [3/3] Compiling Native macOS Menu Bar & Screen Overlay (Slop Grenade.app)..."
  rm -rf "$APP_BUNDLE"
  mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources/web"
  cp "$REPO_ROOT/macos/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
  cp "$REPO_ROOT/rust/target/release/slop-grenade" "$APP_BUNDLE/Contents/MacOS/slop-grenade"
  cp -R "$REPO_ROOT/web/build" "$APP_BUNDLE/Contents/Resources/web/build"
  swiftc -O "$REPO_ROOT/macos/SlopGrenadeOverlay.swift" \
    -framework Cocoa -framework WebKit \
    -o "$APP_BUNDLE/Contents/MacOS/slop-grenade-overlay"
fi

# Clear quarantine attributes and ad-hoc sign for smooth local execution on Apple Silicon
xattr -cr "$APP_BUNDLE" >/dev/null 2>&1 || true
codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null 2>&1 || true

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.threadkeeper.slop-grenade</string>
    <key>ProgramArguments</key>
    <array>
        <string>$APP_BUNDLE/Contents/MacOS/slop-grenade-overlay</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>
EOF

echo "================================================================"
echo "  SLOP GRENADE INSTALLED ON MACOS!"
echo "  App Bundle        : $APP_BUNDLE"
echo "  LaunchAgent       : $PLIST_PATH"
echo "  Web Dashboard URL : http://127.0.0.1:8090/"
echo "================================================================"

open "$APP_BUNDLE"
