#!/usr/bin/env bash
set -euo pipefail
mobile="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-debug}"
case "$mode" in
  debug) task=:app:assembleDebug ;;
  release)
    : "${SLOP_ANDROID_KEYSTORE:?Missing release keystore path}"
    : "${SLOP_ANDROID_STORE_PASSWORD:?Missing release store password}"
    : "${SLOP_ANDROID_KEY_ALIAS:?Missing release key alias}"
    : "${SLOP_ANDROID_KEY_PASSWORD:?Missing release key password}"
    [[ -f "$SLOP_ANDROID_KEYSTORE" ]] || { printf '%s\n' "Release keystore not found." >&2; exit 1; }
    task=:app:assembleRelease ;;
  *) printf '%s\n' "Usage: build-android.sh [debug|release]" >&2; exit 2 ;;
esac
bash "$mobile/scripts/package-assets.sh"
bash "$mobile/scripts/build-native.sh"
"$mobile/gradlew" -p "$mobile" "$task" --no-daemon
apk="$mobile/app/build/outputs/apk/$mode/app-$mode.apk"
sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
tools="$sdk/build-tools/${ANDROID_BUILD_TOOLS_VERSION:-35.0.0}"
[[ -x "$tools/zipalign" && -x "$tools/apksigner" ]] || {
  printf '%s\n' "Install build-tools 35.0.0 or set ANDROID_BUILD_TOOLS_VERSION." >&2; exit 1;
}
"$tools/zipalign" -c -P 16 4 "$apk"
"$tools/apksigner" verify "$apk"
python -c '
import sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as apk:
    libs=[n for n in apk.namelist() if n.startswith("lib/") and n.endswith("/libslop_mobile_bridge.so")]
    expected={"lib/arm64-v8a/libslop_mobile_bridge.so","lib/x86_64/libslop_mobile_bridge.so"}
    assert len(libs)==2 and set(libs)==expected, "Packaged JNI libraries do not match ABI filters"
print("Verified packaged JNI ABIs, signature and 16KB ZIP alignment.")
' "$apk"
python "$mobile/scripts/verify_apk_assets.py" "$apk" "$mobile/app/src/main/assets"
# Never emit a checksum for a failed build or fabricate release credentials.
bash "$mobile/scripts/artifact-checksum.sh" "$apk" --write
