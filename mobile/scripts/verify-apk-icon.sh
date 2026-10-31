#!/usr/bin/env bash
set -euo pipefail
apk="${1:?Usage: verify-apk-icon.sh apk aapt2 foreground.png}"
aapt2="${2:?Usage: verify-apk-icon.sh apk aapt2 foreground.png}"
art="${3:?Usage: verify-apk-icon.sh apk aapt2 foreground.png}"
[[ -f "$apk" && -x "$aapt2" && -f "$art" ]] || {
  printf '%s\n' "APK, Android resource inspector, or launcher artwork is missing." >&2
  exit 1
}
if ! badging="$("$aapt2" dump badging "$apk")"; then
  printf '%s\n' "Could not inspect the APK launcher icon." >&2
  exit 1
fi
[[ "$badging" == *"icon='res/mipmap-anydpi-v26/ic_launcher.xml'"* ]] || {
  printf '%s\n' "APK does not use the Slop Grenade launcher icon." >&2
  exit 1
}
if ! unzip -p "$apk" 'res/drawable-nodpi-v4/ic_launcher_foreground.png' | cmp -s - "$art"; then
  printf '%s\n' "APK launcher artwork does not match the pink grenade." >&2
  exit 1
fi
printf '%s\n' "Verified the APK's pink grenade launcher icon."
