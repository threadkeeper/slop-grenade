#!/usr/bin/env bash
set -euo pipefail
mobile="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$mobile/build"

# Real generated wrapper bytes exercise checksum output without fabricating an APK.
artifact="$mobile/gradle/wrapper/gradle-wrapper.jar"
actual="$(bash "$mobile/scripts/artifact-checksum.sh" "$artifact")"
expected="$(python -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$artifact")"
[[ "${actual%% *}" == "$expected" ]]
printf '%s\n' "PASS: artifact checksum"

python -c '
import hashlib,pathlib,subprocess,sys,tempfile
mobile=pathlib.Path(sys.argv[1])
with tempfile.TemporaryDirectory(prefix="checksum-test-",dir=mobile/"build") as directory:
    fixture=pathlib.Path(directory)/"artifact-fixture.bin"
    fixture.write_bytes(b"synthetic checksum fixture, not an APK")
    subprocess.run(["bash",str(mobile/"scripts/artifact-checksum.sh"),str(fixture),"--write"],check=True,capture_output=True)
    sidecar=fixture.with_name(fixture.name+".sha256")
    expected=hashlib.sha256(fixture.read_bytes()).hexdigest()+"  "+fixture.name+"\n"
    assert sidecar.read_text()==expected
print("PASS: adjacent checksum sidecar")
' "$mobile"

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
import hashlib,pathlib,re,sys
mobile=pathlib.Path(sys.argv[1])
native=(mobile/"scripts/build-native.sh").read_text()
app=(mobile/"app/build.gradle.kts").read_text()
build=(mobile/"scripts/build-android.sh").read_text()
gmail=(mobile/"gmail/src/main/java/com/threadkeeper/slopgrenade/gmail/GmailClient.java").read_text()
wrapper=(mobile/"gradle/wrapper/gradle-wrapper.properties").read_text()
trusted=(mobile/"app/src/main/java/com/threadkeeper/slopgrenade/app/TrustedWebView.kt").read_text()
manifest=(mobile/"app/src/main/AndroidManifest.xml").read_text()
assert native.count("max-page-size=16384") == 2
assert "cargo build --locked --release" in native
assert "aarch64-linux-android:arm64-v8a" in native
assert "x86_64-linux-android:x86_64" in native
assert "abiFilters += setOf(\"arm64-v8a\", \"x86_64\")" in app
assert "libslop_mobile_bridge.so" in app
assert "Java_com_threadkeeper_slopgrenade_core_NativeCore_request" in app
assert "zipalign\" -c -P 16 4" in build
assert "apksigner\" verify" in build
assert "artifact-checksum.sh\" \"$apk\" --write" in build
assert "gradle.startParameter.taskNames" not in app
assert "verifyReleaseSigning" in app
assert "ignoreAssetsPatterns += listOf(" in app
assert "\"<dir>_*\"" not in app
assert "verify_apk_assets.py" in build
assert "\"packageReleaseBundle\"" in app
assert "\"signReleaseBundle\"" in app
assert ".isBlank(" not in gmail and "public record " not in gmail
assert "distributionSha256Sum=f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6" in wrapper
assert hashlib.sha256((mobile/"gradle/wrapper/gradle-wrapper.jar").read_bytes()).hexdigest()=="2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046"
assert "settings.domStorageEnabled = true" in trusted
assert "android:allowBackup=\"false\"" in manifest
quote=chr(39)+chr(34)
pattern=r"localStorage\.setItem\(\s*["+quote+r"]([^"+quote+r"]+)"
keys=set()
for path in (mobile.parent/"web/src").rglob("*"):
    if path.suffix in (".ts",".svelte") and ".test." not in path.name:
        keys.update(re.findall(pattern,path.read_text()))
assert keys=={"slopgrenade.sound","slopgrenade.volume"}, "Only UI sound/volume may be persisted"
print("PASS: ABI, JNI, locked-build and 16KB linker policy")
' "$mobile"

manifest="$mobile/app/src/main/AndroidManifest.xml"
launcher="$mobile/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml"
grep -Fq 'android:icon="@mipmap/ic_launcher"' "$manifest"
grep -Fq 'android:roundIcon="@mipmap/ic_launcher"' "$manifest"
grep -Fq '<adaptive-icon' "$launcher"
grep -Fq '@drawable/ic_launcher_foreground' "$launcher"
test -s "$mobile/app/src/main/res/drawable-nodpi/ic_launcher_foreground.png"
grep -Fq '.setSmallIcon(R.drawable.ic_notification)' "$mobile/app/src/main/java/com/threadkeeper/slopgrenade/app/OverlayService.kt"
grep -Fq '#FFFFFFFF' "$mobile/app/src/main/res/drawable/ic_notification.xml"
printf '%s\n' "PASS: branded launcher and monochrome notification icons"

python -m unittest discover -s "$mobile/scripts" -p 'test_*.py'
