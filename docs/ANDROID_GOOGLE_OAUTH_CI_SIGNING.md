# Scout Instructions: Stable Android Signing for Google OAuth

## Objective

Make the GitHub Actions Android testing APK use a stable signing certificate so Google OAuth can
recognize the installed application.

The Android OAuth identity is:

```text
Package name + signing certificate SHA-1
```

For this application:

```text
Package name: com.threadkeeper.slopgrenade
```

Do not add a Google OAuth client ID or client secret to the Android APK. Google Play Services matches
the package name and signing certificate against the Android OAuth client configured in Google Cloud.

## Current problem

The current workflow builds:

```text
bash mobile/scripts/build-android.sh debug
```

GitHub-hosted runners are ephemeral. If Gradle creates a debug keystore on each runner, the certificate
SHA-1 changes between builds. An APK signed with an unregistered certificate can fail Google
authorization immediately, while the current app may display that failure as a cancellation.

The existing `SLOP_ANDROID_KEYSTORE` variables configure only the release build. The current Android
workflow builds the debug variant and therefore does not use them.

## Required design

Use a dedicated, stable **test signing keystore** for trusted CI builds.

- Do not use the production Play/release signing key for test APKs.
- Do not commit the keystore, passwords, aliases, downloaded OAuth JSON, or personal account addresses.
- Pull requests from forks must continue to compile and test without receiving secrets.
- Only trusted branch, tag, or manually dispatched runs may produce and upload the OAuth-capable signed
  testing APK.
- Unsigned or ephemeral-debug APKs must not be published as installable OAuth test artifacts.

## GitHub configuration

Create these repository or protected-environment **Secrets**:

```text
SLOP_ANDROID_TEST_KEYSTORE_BASE64
SLOP_ANDROID_TEST_STORE_PASSWORD
SLOP_ANDROID_TEST_KEY_ALIAS
SLOP_ANDROID_TEST_KEY_PASSWORD
```

Create this repository **Variable**:

```text
GOOGLE_ANDROID_TEST_CERT_SHA1
```

The SHA-1 fingerprint is public certificate metadata, so it may be a GitHub Variable. Passwords and the
keystore must be Secrets.

Do not create GitHub variables named `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or similar for the
Android authorization flow. They are not consumed by the current Android implementation and are not
how Google identifies an Android OAuth application.

## Create the dedicated test keystore

Run this once on a secured administrator workstation, not in CI:

```bash
keytool -genkeypair \
  -keystore slop-grenade-android-test.jks \
  -alias slop-grenade-test \
  -keyalg RSA \
  -keysize 3072 \
  -validity 3650 \
  -storetype PKCS12
```

Requirements:

1. Use strong unique passwords.
2. Store the original keystore in an approved secure backup location.
3. Never send it through chat, issue comments, build logs, or source control.
4. Base64-encode it locally for the GitHub secret:

   ```bash
   base64 -w 0 slop-grenade-android-test.jks > slop-grenade-android-test.jks.base64
   ```

   On macOS:

   ```bash
   base64 < slop-grenade-android-test.jks | tr -d '\n' > slop-grenade-android-test.jks.base64
   ```

5. Put the encoded content in `SLOP_ANDROID_TEST_KEYSTORE_BASE64`.
6. Securely delete the temporary Base64 text after the GitHub secret is configured.

## Determine and register the certificate

Print the certificate fingerprints locally:

```bash
keytool -list -v \
  -keystore slop-grenade-android-test.jks \
  -alias slop-grenade-test
```

Copy the certificate's SHA-1 fingerprint into:

```text
GOOGLE_ANDROID_TEST_CERT_SHA1
```

In Google Cloud:

1. Enable the Gmail API in the testing project.
2. Configure the OAuth consent screen.
3. While the OAuth app is in testing, add the intended acceptance-test accounts as test users.
4. Create or update an **Android** OAuth client with:

   ```text
   Package name: com.threadkeeper.slopgrenade
   SHA-1:        value from the dedicated test keystore
   ```

5. Do not use a Web or Desktop OAuth client for the APK.
6. Do not put the Android OAuth client ID into the app.

## Gradle changes

Update `mobile/app/build.gradle.kts`.

### Test signing environment

Read these environment variables:

```text
SLOP_ANDROID_TEST_KEYSTORE
SLOP_ANDROID_TEST_STORE_PASSWORD
SLOP_ANDROID_TEST_KEY_ALIAS
SLOP_ANDROID_TEST_KEY_PASSWORD
```

`SLOP_ANDROID_TEST_KEYSTORE` is the absolute path to the decoded temporary keystore on the runner. It is
not the Base64 secret.

### Signing configuration

Add a `testing` signing configuration only when all four test-signing environment variables are
present. Apply it to the debug build:

```kotlin
val testSigningNames = listOf(
    "SLOP_ANDROID_TEST_KEYSTORE",
    "SLOP_ANDROID_TEST_STORE_PASSWORD",
    "SLOP_ANDROID_TEST_KEY_ALIAS",
    "SLOP_ANDROID_TEST_KEY_PASSWORD",
)

signingConfigs {
    if (testSigningNames.all { !System.getenv(it).isNullOrBlank() }) {
        create("testing") {
            storeFile = file(System.getenv("SLOP_ANDROID_TEST_KEYSTORE"))
            storePassword = System.getenv("SLOP_ANDROID_TEST_STORE_PASSWORD")
            keyAlias = System.getenv("SLOP_ANDROID_TEST_KEY_ALIAS")
            keyPassword = System.getenv("SLOP_ANDROID_TEST_KEY_PASSWORD")
        }
    }
}

buildTypes {
    getByName("debug") {
        signingConfig = signingConfigs.findByName("testing") ?: signingConfig
    }
}
```

Integrate this with the existing release signing configuration rather than replacing it.

### Fail-closed task

Add a Gradle task that fails a trusted distributable test build if:

- Any test-signing variable is absent.
- The resolved keystore does not exist.
- The debug build is not using the `testing` signing configuration.

Do not make ordinary fork pull-request compilation depend on the secret-backed task. Invoke the task
explicitly from the trusted artifact workflow.

Add unit or build-policy coverage that proves:

- A complete test-signing environment selects the testing signing configuration.
- Partial configuration fails closed.
- Release signing remains unchanged.
- The source does not contain keystore bytes or passwords.

## GitHub Actions changes

Update `.github/workflows/android.yml`.

### Preserve untrusted pull-request validation

Pull requests must still run:

- Rust gates.
- Web gates.
- JVM tests.
- Android unit tests and lint.
- A normal debug compilation if useful.

Fork pull requests do not receive signing secrets. Do not make their validation fail merely because
OAuth-capable signing is unavailable.

Do not upload the ephemeral pull-request debug APK as the Gmail OAuth testing artifact.

### Restore the keystore for trusted builds

For trusted `push`, tag, or `workflow_dispatch` runs:

1. Decode the keystore into `${RUNNER_TEMP}`.
2. Restrict its file permissions.
3. Export only its temporary path through `GITHUB_ENV`.
4. Map passwords and alias directly from GitHub Secrets.
5. Never print the Base64 value or passwords.

Example:

```yaml
- name: Restore Android test signing keystore
  if: github.event_name != 'pull_request'
  shell: bash
  env:
    KEYSTORE_BASE64: ${{ secrets.SLOP_ANDROID_TEST_KEYSTORE_BASE64 }}
  run: |
    set -euo pipefail
    test -n "$KEYSTORE_BASE64"
    keystore="$RUNNER_TEMP/slop-grenade-android-test.jks"
    printf '%s' "$KEYSTORE_BASE64" | base64 --decode > "$keystore"
    chmod 600 "$keystore"
    echo "SLOP_ANDROID_TEST_KEYSTORE=$keystore" >> "$GITHUB_ENV"
```

The trusted build step needs:

```yaml
env:
  SLOP_ANDROID_TEST_STORE_PASSWORD: ${{ secrets.SLOP_ANDROID_TEST_STORE_PASSWORD }}
  SLOP_ANDROID_TEST_KEY_ALIAS: ${{ secrets.SLOP_ANDROID_TEST_KEY_ALIAS }}
  SLOP_ANDROID_TEST_KEY_PASSWORD: ${{ secrets.SLOP_ANDROID_TEST_KEY_PASSWORD }}
```

Run the fail-closed signing verification task before or as part of:

```text
bash mobile/scripts/build-android.sh debug
```

### Verify the produced APK certificate

After the APK is built, extract its actual SHA-1 using Android Build Tools:

```bash
apk="mobile/app/build/outputs/apk/debug/app-debug.apk"
apksigner="${ANDROID_SDK_ROOT}/build-tools/35.0.0/apksigner"

actual_sha1="$(
  "$apksigner" verify --print-certs "$apk" |
    awk -F': ' '/Signer #1 certificate SHA-1 digest/ { print toupper($2) }'
)"
expected_sha1="$(printf '%s' "${GOOGLE_ANDROID_TEST_CERT_SHA1}" |
  tr '[:lower:]' '[:upper:]' |
  tr -d ':[:space:]')"
actual_sha1="$(printf '%s' "$actual_sha1" | tr -d ':[:space:]')"

test -n "$actual_sha1"
test "$actual_sha1" = "$expected_sha1"
```

Supply `GOOGLE_ANDROID_TEST_CERT_SHA1` from GitHub Variables:

```yaml
env:
  GOOGLE_ANDROID_TEST_CERT_SHA1: ${{ vars.GOOGLE_ANDROID_TEST_CERT_SHA1 }}
```

Fail the workflow before artifact upload if the fingerprints differ.

The certificate fingerprint is not secret and may appear in logs. Keystore content, aliases, and
passwords must not.

### Artifact naming

Rename the trusted artifact so testers cannot confuse it with an ephemeral debug build:

```text
slop-grenade-android-oauth-test
```

The artifact must include:

```text
slop-grenade-android-oauth-test.apk
slop-grenade-android-oauth-test.apk.sha256
```

Do not attach an OAuth testing APK to a public production release unless the release process explicitly
approves that test certificate and artifact.

## APK acceptance verification

For every trusted test artifact:

1. Verify its checksum.
2. Verify its signing certificate:

   ```bash
   apksigner verify --print-certs slop-grenade-android-oauth-test.apk
   ```

3. Confirm:

   ```text
   Package: com.threadkeeper.slopgrenade
   SHA-1:   GOOGLE_ANDROID_TEST_CERT_SHA1
   ```

4. Install that exact APK.
5. Open Slop Grenade.
6. Select **Authorize Gmail account**.
7. Select an account listed as a Google OAuth test user.
8. Confirm the Google consent screen requests only read-only Gmail access.
9. Confirm `/profile` verification succeeds and the mailbox appears connected.
10. Confirm a seven-day quiet scan completes without historical overlay effects.

If authorization still fails, collect only:

- APK SHA-256 checksum.
- APK signer SHA-1.
- Package name.
- Android version.
- Google Play Services version.
- Whether the account is an OAuth test user.
- Sanitized Google Play Services status category.

Do not collect account addresses, access tokens, authorization payloads, message content, or credential
files.

## Related application fix

After stable signing is working, improve Android authorization error classification separately.

The app must distinguish:

- User cancellation.
- Missing or mismatched Android OAuth client configuration.
- Network or Google Play Services transient failure.
- Workspace administrator policy denial.
- Consent-screen/test-user denial.

Do not display every failure as “Google authorization was cancelled.” Do not expose raw exceptions,
tokens, account names, or Google response bodies. Add deterministic tests for each sanitized error
category.

## Definition of done

- Trusted CI builds use the same dedicated test signing certificate on every run.
- The workflow compares the APK's actual signer SHA-1 with the Google-registered expected SHA-1.
- The Google testing project contains an Android OAuth client for the exact package/SHA-1 pair.
- Fork pull requests run without access to signing secrets.
- Only the trusted, stable-signed APK is uploaded as the OAuth testing artifact.
- Gmail authorization works for configured OAuth test users.
- No keystore, password, token, OAuth JSON, or personal email address is committed or logged.
- Existing release signing remains unchanged.
