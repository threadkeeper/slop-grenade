#!/usr/bin/env bash
set -euo pipefail
mobile="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# Real generated wrapper bytes exercise checksum output without fabricating an APK.
artifact="$mobile/gradle/wrapper/gradle-wrapper.jar"
actual="$(bash "$mobile/scripts/artifact-checksum.sh" "$artifact")"
expected="$(python -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$artifact")"
[[ "${actual%% *}" == "$expected" ]]
printf '%s\n' "PASS: artifact checksum"

if bash "$mobile/scripts/artifact-checksum.sh" "$mobile/build/definitely-missing.apk"; then
  printf '%s\n' "FAIL: nonexistent artifact accepted" >&2
  exit 1
fi
printf '%s\n' "PASS: missing artifact rejected"

if env -u SLOP_ANDROID_KEYSTORE -u SLOP_ANDROID_STORE_PASSWORD -u SLOP_ANDROID_KEY_ALIAS -u SLOP_ANDROID_KEY_PASSWORD \
    bash "$mobile/scripts/build-android.sh" release; then
  printf '%s\n' "FAIL: release accepted absent credentials" >&2
  exit 1
fi
printf '%s\n' "PASS: missing release credentials rejected"

python -c '
import pathlib,sys
mobile=pathlib.Path(sys.argv[1])
native=(mobile/"scripts/build-native.sh").read_text()
app=(mobile/"app/build.gradle.kts").read_text()
build=(mobile/"scripts/build-android.sh").read_text()
assert native.count("max-page-size=16384") == 2
assert "cargo build --locked --release" in native
assert "aarch64-linux-android:arm64-v8a" in native
assert "x86_64-linux-android:x86_64" in native
assert "abiFilters += setOf(\"arm64-v8a\", \"x86_64\")" in app
assert "libslop_mobile_bridge.so" in app
assert "Java_com_threadkeeper_slopgrenade_core_NativeCore_request" in app
assert "zipalign\" -c -P 16 4" in build
assert "apksigner\" verify" in build
print("PASS: ABI, JNI, locked-build and 16KB linker policy")
' "$mobile"
