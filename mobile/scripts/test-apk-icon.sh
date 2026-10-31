#!/usr/bin/env bash
set -euo pipefail
mobile="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$mobile/build"
tmp="$(mktemp -d "$mobile/build/apk-icon-test.XXXXXXXX")"
cleanup() {
  rm -f -- "$tmp/res/drawable-nodpi-v4/ic_launcher_foreground.png" "$tmp/aapt2" "$tmp/fixture.apk" "$tmp/missing.apk"
  rmdir -- "$tmp/res/drawable-nodpi-v4" "$tmp/res" "$tmp"
}
trap cleanup EXIT
mkdir -p "$tmp/res/drawable-nodpi-v4"
art="$mobile/app/src/main/res/drawable-nodpi/ic_launcher_foreground.png"
cp "$art" "$tmp/res/drawable-nodpi-v4/ic_launcher_foreground.png"
cat > "$tmp/aapt2" <<'EOF'
#!/usr/bin/env bash
if [[ "${BAD_ICON:-0}" == 1 ]]; then
  printf "%s\n" "application: label='Slop Grenade' icon='res/mipmap-anydpi-v26/other.xml'"
else
  printf "%s\n" "application: label='Slop Grenade' icon='res/mipmap-anydpi-v26/ic_launcher.xml'"
fi
EOF
chmod +x "$tmp/aapt2"
jar cf "$tmp/fixture.apk" -C "$tmp" res/drawable-nodpi-v4/ic_launcher_foreground.png
jar cf "$tmp/missing.apk" -C "$tmp" aapt2

bash "$mobile/scripts/verify-apk-icon.sh" "$tmp/fixture.apk" "$tmp/aapt2" "$art"
if BAD_ICON=1 bash "$mobile/scripts/verify-apk-icon.sh" "$tmp/fixture.apk" "$tmp/aapt2" "$art"; then
  printf '%s\n' "FAIL: an incorrect launcher icon was accepted" >&2
  exit 1
fi
if bash "$mobile/scripts/verify-apk-icon.sh" "$tmp/fixture.apk" "$tmp/aapt2" \
    "$mobile/../docs/screenshots/slop-grenade-icon-120.png"; then
  printf '%s\n' "FAIL: incorrect launcher artwork was accepted" >&2
  exit 1
fi
if bash "$mobile/scripts/verify-apk-icon.sh" "$tmp/missing.apk" "$tmp/aapt2" "$art"; then
  printf '%s\n' "FAIL: an APK without launcher artwork was accepted" >&2
  exit 1
fi
printf '%s\n' "PASS: APK launcher icon and artwork verification"
