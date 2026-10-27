#!/usr/bin/env bash
set -euo pipefail
mobile="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$mobile/build"
fixture="$(mktemp -d "$mobile/build/signing-policy-XXXXXX")"
trap 'rm -rf -- "$fixture"' EXIT
# The verification task checks configuration, not key bytes; no real key is used.
printf '%s\n' "synthetic file, not a signing key" > "$fixture/synthetic.jks"
unset SLOP_ANDROID_KEYSTORE SLOP_ANDROID_STORE_PASSWORD SLOP_ANDROID_KEY_ALIAS SLOP_ANDROID_KEY_PASSWORD
export SLOP_ANDROID_TEST_KEYSTORE="$fixture/synthetic.jks"
export SLOP_ANDROID_TEST_STORE_PASSWORD="synthetic-store-value"
export SLOP_ANDROID_TEST_KEY_ALIAS="synthetic-key-name"
export SLOP_ANDROID_TEST_KEY_PASSWORD="synthetic-key-value"
gradle=("$mobile/gradlew" -p "$mobile" --no-daemon --console=plain)
"${gradle[@]}" :app:verifyTestSigning > "$fixture/result" 2>&1 || {
  printf '%s\n' "FAIL: a complete synthetic signing environment was not accepted." >&2
  cat "$fixture/result" >&2
  exit 1
}
for name in SLOP_ANDROID_TEST_KEYSTORE SLOP_ANDROID_TEST_STORE_PASSWORD SLOP_ANDROID_TEST_KEY_ALIAS SLOP_ANDROID_TEST_KEY_PASSWORD; do
  if env -u "$name" "${gradle[@]}" :app:verifyTestSigning > "$fixture/result" 2>&1; then
    printf '%s\n' "FAIL: partial test signing was accepted." >&2
    exit 1
  fi
  grep -q "OAuth test APK packaging requires all test-signing environment variables" "$fixture/result" || {
    printf '%s\n' "FAIL: partial signing failed for an unexpected reason." >&2
    exit 1
  }
done
for path in "$fixture/missing.jks" "relative-signing-fixture.jks"; do
  if SLOP_ANDROID_TEST_KEYSTORE="$path" "${gradle[@]}" :app:verifyTestSigning > "$fixture/result" 2>&1; then
    printf '%s\n' "FAIL: invalid keystore path was accepted." >&2
    exit 1
  fi
  grep -q "Test signing requires an existing absolute keystore path" "$fixture/result" || {
    printf '%s\n' "FAIL: invalid keystore path failed for an unexpected reason." >&2
    exit 1
  }
done
if "${gradle[@]}" :app:verifyReleaseSigning > "$fixture/result" 2>&1; then
  printf '%s\n' "FAIL: test credentials were accepted for release signing." >&2
  exit 1
fi
grep -q "Unsigned release packaging is prohibited" "$fixture/result"
printf '%s\n' "PASS: complete test signing, fail-closed partial/path checks, and independent release signing."
