#!/usr/bin/env bash
set -euo pipefail
apk="${1:?Provide the built OAuth test APK}"
expected_sha1="$(printf '%s' "${GOOGLE_ANDROID_TEST_CERT_SHA1:-}" | tr '[:lower:]' '[:upper:]' | tr -d ':[:space:]')"
[[ "$expected_sha1" =~ ^[0-9A-F]{40}$ ]] || {
  printf '%s\n' "Configure GOOGLE_ANDROID_TEST_CERT_SHA1 with the registered test certificate SHA-1." >&2
  exit 1
}
[[ -f "$apk" ]] || { printf '%s\n' "OAuth test APK not found." >&2; exit 1; }
sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
tools="$sdk/build-tools/${ANDROID_BUILD_TOOLS_VERSION:-35.0.0}"
[[ -n "$sdk" && -x "$tools/apksigner" && -x "$tools/aapt2" ]] || {
  printf '%s\n' "Install Android Build Tools 35.0.0 or set ANDROID_BUILD_TOOLS_VERSION." >&2
  exit 1
}
certificates="$("$tools/apksigner" verify --print-certs "$apk")"
mapfile -t signers < <(printf '%s\n' "$certificates" |
  awk -F': ' '/^Signer #[0-9]+ certificate SHA-1 digest:/ { print toupper($2) }')
[[ "${#signers[@]}" == 1 ]] || {
  printf '%s\n' "OAuth test APK must have exactly one verified signing certificate." >&2
  exit 1
}
actual_sha1="$(printf '%s' "${signers[0]}" | tr -d ':[:space:]')"
[[ "$actual_sha1" =~ ^[0-9A-F]{40}$ && "$actual_sha1" == "$expected_sha1" ]] || {
  printf '%s\n' "OAuth test APK signer does not match the Google-registered test certificate." >&2
  exit 1
}
badging="$("$tools/aapt2" dump badging "$apk")"
package="$(printf '%s\n' "$badging" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")"
[[ "$package" == "com.threadkeeper.slopgrenade" ]] || {
  printf '%s\n' "OAuth test APK package does not match the registered Android application." >&2
  exit 1
}
printf 'Verified OAuth test APK package com.threadkeeper.slopgrenade and signer SHA-1 %s.\n' "$actual_sha1"
