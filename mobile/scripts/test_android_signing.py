"""Synthetic certificate-verification and CI signing-boundary regression tests."""

import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


MOBILE = Path(__file__).resolve().parents[1]
SYNTHETIC_SHA1 = "0123456789ABCDEF0123456789ABCDEF01234567"


class AndroidSigningPolicyTests(unittest.TestCase):
    def test_testing_configuration_is_complete_only_and_debug_only(self):
        source = (MOBILE / "app" / "build.gradle.kts").read_text()
        names = re.search(r"val testSigningNames = listOf\((.*?)\)", source, re.S).group(1)
        self.assertEqual(set(re.findall(r'"([^"]+)"', names)), {
            "SLOP_ANDROID_TEST_KEYSTORE",
            "SLOP_ANDROID_TEST_STORE_PASSWORD",
            "SLOP_ANDROID_TEST_KEY_ALIAS",
            "SLOP_ANDROID_TEST_KEY_PASSWORD",
        })
        self.assertIn('if (testSigningNames.all { !System.getenv(it).isNullOrBlank() }) create("testing")', source)
        self.assertIn('storeType = "PKCS12"', source)
        self.assertIn('signingConfig = signingConfigs.findByName("testing") ?: signingConfig', source)
        task = source.split('tasks.register("verifyTestSigning")', 1)[1]
        self.assertIn('require(testSigningNames.all { !System.getenv(it).isNullOrBlank() })', task)
        self.assertIn("keystore.isAbsolute && keystore.isFile", task)
        self.assertIn('android.buildTypes.getByName("debug").signingConfig?.name == "testing"', task)
        self.assertNotIn('dependsOn("verifyTestSigning")', source)
        self.assertIn('signingConfig = signingConfigs.findByName("environment")', source)
        self.assertIn('if (signingNames.all { !System.getenv(it).isNullOrBlank() }) create("environment")', source)
        for field in ("storePassword", "keyAlias", "keyPassword"):
            for assignment in re.findall(rf"^\s*{field} = (.+)$", source, re.M):
                self.assertRegex(assignment, r'^System\.getenv\("SLOP_ANDROID_(TEST_)?[A-Z_]+"\)$')
        self.assertNotIn("googleusercontent.com", source)
        self.assertNotIn("client_secret", source)

    def test_untrusted_validation_cannot_publish_or_receive_signing_secrets(self):
        workflow = (MOBILE.parent / ".github" / "workflows" / "android.yml").read_text()
        compatibility, artifact = workflow.split("  oauth-test-apk:\n", 1)
        self.assertNotIn("secrets.", compatibility)
        self.assertNotIn("upload-artifact@", compatibility)
        for gate in ("Rust compatibility gates", "Web compatibility gates",
                     "test-jvm.sh", "build-policy.test.sh", "test-signing-config.sh",
                     "testDebugUnitTest", "lintDebug", "build-android.sh debug"):
            self.assertIn(gate, compatibility)
        self.assertIn("needs: compatibility", artifact)
        self.assertIn("if: github.event_name == 'push' || github.event_name == 'workflow_dispatch'", artifact)
        self.assertNotIn("pull_request_target", workflow)
        self.assertIn("contents: read", workflow)
        self.assertNotIn("gh release upload", workflow)
        self.assertNotIn("slop-grenade-android-debug", workflow)
        self.assertIn('umask 077', artifact)
        self.assertIn('chmod 600 "$keystore"', artifact)
        self.assertIn('printf \'%s\' "$KEYSTORE_BASE64" | base64 --decode', artifact)
        self.assertIn('echo "SLOP_ANDROID_TEST_KEYSTORE=$keystore" >> "$GITHUB_ENV"', artifact)
        for line in artifact.splitlines():
            if "GITHUB_ENV" in line:
                self.assertNotRegex(line, r"PASSWORD|KEY_ALIAS|KEYSTORE_BASE64")
        for name in ("KEYSTORE_BASE64", "STORE_PASSWORD", "KEY_ALIAS", "KEY_PASSWORD"):
            self.assertIn("${{ secrets.SLOP_ANDROID_TEST_" + name + " }}", artifact)
        self.assertIn("${{ vars.GOOGLE_ANDROID_TEST_CERT_SHA1 }}", artifact)
        self.assertNotIn("secrets.SLOP_ANDROID_KEY", artifact)
        self.assertNotIn("vars.GOOGLE_CLIENT", artifact)
        self.assertLess(artifact.index(":app:verifyTestSigning"), artifact.index("build-android.sh debug"))
        self.assertLess(artifact.index("verify-oauth-test-apk.sh"), artifact.index("upload-artifact@"))
        self.assertIn("name: slop-grenade-android-oauth-test", artifact)
        self.assertIn("slop-grenade-android-oauth-test.apk.sha256", artifact)
        self.assertIn("if: always()", artifact)
        self.assertIn('rm -f -- "$RUNNER_TEMP/slop-grenade-android-test.jks"', artifact)


class OAuthApkCertificateTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="android-signing-fixture-")
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        self.apk = root / "synthetic.apk"
        self.apk.write_bytes(b"synthetic fixture; not a distributable APK")
        tools = root / "sdk" / "build-tools" / "35.0.0"
        tools.mkdir(parents=True)
        for name, script in {
            "apksigner": '#!/usr/bin/env bash\nprintf "%s\\n" "$FIXTURE_CERTIFICATES"\nexit "${FIXTURE_SIGNER_EXIT:-0}"\n',
            "aapt2": '#!/usr/bin/env bash\nprintf "%s\\n" "$FIXTURE_BADGING"\nexit "${FIXTURE_AAPT_EXIT:-0}"\n',
        }.items():
            path = tools / name
            path.write_text(script)
            path.chmod(0o700)
        self.environment = {
            **os.environ,
            "ANDROID_SDK_ROOT": str(root / "sdk"),
            "ANDROID_BUILD_TOOLS_VERSION": "35.0.0",
            "GOOGLE_ANDROID_TEST_CERT_SHA1": SYNTHETIC_SHA1,
            "FIXTURE_CERTIFICATES": f"Signer #1 certificate SHA-1 digest: {SYNTHETIC_SHA1.lower()}",
            "FIXTURE_BADGING": "package: name='com.threadkeeper.slopgrenade' versionCode='1'",
            "FIXTURE_SIGNER_EXIT": "0",
            "FIXTURE_AAPT_EXIT": "0",
        }

    def verify(self, **changes):
        return subprocess.run(
            [shutil.which("bash") or "bash", str(MOBILE / "scripts" / "verify-oauth-test-apk.sh"), str(self.apk)],
            env={**self.environment, **changes}, capture_output=True, text=True, check=False,
        )

    def test_actual_single_signer_and_package_match(self):
        self.assertEqual(self.verify().returncode, 0)
        fingerprint = ":".join(SYNTHETIC_SHA1[index:index + 2] for index in range(0, 40, 2))
        self.assertEqual(self.verify(GOOGLE_ANDROID_TEST_CERT_SHA1=f" {fingerprint.lower()}\n").returncode, 0)

    def test_missing_invalid_or_different_expected_certificate_fails(self):
        for expected in ("", "not-a-fingerprint", "A" * 40, SYNTHETIC_SHA1 + SYNTHETIC_SHA1):
            with self.subTest(expected=expected):
                self.assertNotEqual(self.verify(GOOGLE_ANDROID_TEST_CERT_SHA1=expected).returncode, 0)

    def test_missing_malformed_or_multiple_actual_signers_fail(self):
        for certificates in (
            "", "Signer #1 certificate SHA-1 digest: invalid",
            f"Signer #1 certificate SHA-1 digest: {SYNTHETIC_SHA1}\nSigner #2 certificate SHA-1 digest: {SYNTHETIC_SHA1}",
        ):
            with self.subTest(certificates=certificates):
                self.assertNotEqual(self.verify(FIXTURE_CERTIFICATES=certificates).returncode, 0)

    def test_invalid_signature_or_wrong_package_fails(self):
        self.assertNotEqual(self.verify(FIXTURE_SIGNER_EXIT="1").returncode, 0)
        self.assertNotEqual(self.verify(FIXTURE_BADGING="package: name='com.example.invalid'").returncode, 0)
        self.assertNotEqual(self.verify(FIXTURE_BADGING="").returncode, 0)
        self.assertNotEqual(self.verify(FIXTURE_AAPT_EXIT="1").returncode, 0)


if __name__ == "__main__":
    unittest.main()
