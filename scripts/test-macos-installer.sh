#!/usr/bin/env bash
set -euo pipefail

sudo installer -pkg "${1:?Usage: test-macos-installer.sh installer.pkg}" -target /
app="/Applications/Slop Grenade.app"
test -x "$app/Contents/MacOS/slop-grenade-overlay"
test -x "$app/Contents/MacOS/slop-grenade"
test -s "$app/Contents/Resources/web/build/index.html"
test -s "$app/Contents/Resources/web/build/favicon.png"
icon="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$app/Contents/Info.plist")"
test "$icon" = "SlopGrenade.icns"
test -s "$app/Contents/Resources/$icon"
sips -g pixelWidth "$app/Contents/Resources/$icon" >/dev/null
codesign --verify --deep --strict "$app"
for binary in slop-grenade slop-grenade-overlay; do
  lipo "$app/Contents/MacOS/$binary" -verify_arch arm64 x86_64
done

HTTP_BIND=127.0.0.1:18090 SLOP_AUTO_POLL=0 GMAIL_ENABLED=0 \
  WEB_ASSET_DIR="$app/Contents/Resources/web/build" \
  "$app/Contents/MacOS/slop-grenade" &
daemon_pid=$!
trap 'kill "$daemon_pid"; wait "$daemon_pid" || true' EXIT
ready=false
for attempt in {1..30}; do
  kill -0 "$daemon_pid"
  if curl --silent --fail http://127.0.0.1:18090/api/v1/health >/dev/null; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "Installed daemon did not become healthy." >&2
  exit 1
fi
curl --silent --show-error --fail http://127.0.0.1:18090/ \
  --output "${RUNNER_TEMP:?}/installed-dashboard.html"
grep -q '_app/' "$RUNNER_TEMP/installed-dashboard.html"
