"""Release completeness and native-installer regression tests."""

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("release", ROOT / "scripts/release.py")
release = importlib.util.module_from_spec(SPEC)
if SPEC.loader is not None:
    SPEC.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.assets = Path(self.temp.name)
        for name in release.PACKAGES:
            package = self.assets / name
            package.write_bytes(b"synthetic package: " + name.encode())
            checksum = hashlib.sha256(package.read_bytes()).hexdigest()
            package.with_name(name + ".sha256").write_text(f"{checksum}  {name}\n")

    def test_complete_release_has_every_platform_installer_and_checksum(self):
        verified = release.verify_assets(self.assets)
        self.assertEqual(len(verified), 10)
        for suffix in ("windows-x64-setup.exe", "macos-universal.pkg", "android.apk"):
            self.assertTrue(any(name.endswith(suffix) for name in verified))

    def test_missing_empty_corrupt_or_unexpected_asset_is_rejected(self):
        for change in ("missing", "empty", "corrupt", "unexpected", "symlink"):
            with self.subTest(change=change):
                name = release.PACKAGES[0]
                package = self.assets / name
                original = package.read_bytes()
                if change == "missing":
                    package.unlink()
                elif change == "empty":
                    package.write_bytes(b"")
                elif change == "corrupt":
                    package.write_bytes(b"corrupt")
                elif change == "unexpected":
                    (self.assets / "extra.apk").touch()
                else:
                    package.unlink()
                    package.symlink_to(self.assets / release.PACKAGES[1])
                with self.assertRaises(ValueError):
                    release.verify_assets(self.assets)
                if package.is_symlink():
                    package.unlink()
                package.write_bytes(original)
                (self.assets / "extra.apk").unlink(missing_ok=True)

    def test_checksum_must_name_exact_package(self):
        checksum = self.assets / (release.PACKAGES[0] + ".sha256")
        for text in ("", "invalid", "0" * 64 + "  ../outside.exe",
                     checksum.read_text() + "extra line\n"):
            with self.subTest(text=text):
                checksum.write_text(text)
                with self.assertRaises(ValueError):
                    release.verify_assets(self.assets)

    def test_only_plain_version_tags_are_accepted(self):
        self.assertEqual(release.version_from_tag("v1.2.3"), "1.2.3")
        for tag in ("main", "v1.2", "v1.2.3-preview", "v1.2.3-experimental", "v1.2.3\n"):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                release.version_from_tag(tag)

    def run_publisher(self, existing=None, remote_change=None):
        commands = []
        expected = release.verify_assets(self.assets)

        def gh(*args):
            commands.append(args)
            if args[:2] == ("release", "list"):
                return json.dumps([] if existing is None else [existing])
            if args[:2] == ("release", "view"):
                remote = {
                    "isDraft": True,
                    "assets": [
                        {"name": name, "digest": "sha256:" + digest,
                         "size": (self.assets / name).stat().st_size}
                        for name, digest in expected.items()
                    ],
                }
                if remote_change:
                    remote_change(remote)
                return json.dumps(remote)
            return ""

        with patch.object(release, "gh", side_effect=gh):
            release.publish("v1.2.3", self.assets)
        return commands

    def test_publishes_only_after_upload_and_remote_verification(self):
        commands = self.run_publisher()
        create = next(command for command in commands if command[:2] == ("release", "create"))
        self.assertIn("--draft", create)
        self.assertIn("--verify-tag", create)
        self.assertEqual([command[1] for command in commands],
                         ["list", "create", "upload", "view", "edit"])
        self.assertIn("--draft=false", commands[-1])
        self.assertIn("--latest", commands[-1])

    def test_rerun_resumes_draft_but_never_mutates_public_release(self):
        commands = self.run_publisher({"tagName": "v1.2.3", "isDraft": True})
        self.assertNotIn("create", [command[1] for command in commands])
        with self.assertRaises(ValueError):
            self.run_publisher({"tagName": "v1.2.3", "isDraft": False})

    def test_missing_or_mismatched_remote_asset_never_publishes(self):
        for change in (
            lambda remote: remote["assets"].pop(),
            lambda remote: remote["assets"][0].update(digest="sha256:" + "0" * 64),
            lambda remote: remote["assets"][0].update(size=0),
            lambda remote: remote.update(isDraft=False),
        ):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.run_publisher(remote_change=change)

    def test_invalid_local_assets_do_not_call_github(self):
        (self.assets / release.PACKAGES[0]).unlink()
        with patch.object(release, "gh") as gh, self.assertRaises(ValueError):
            release.publish("v1.2.3", self.assets)
        gh.assert_not_called()

    def test_github_errors_are_not_treated_as_missing_releases(self):
        with patch.object(release, "gh", side_effect=subprocess.CalledProcessError(1, "gh")):
            with self.assertRaises(subprocess.CalledProcessError):
                release.publish("v1.2.3", self.assets)


class PackagingPolicyTests(unittest.TestCase):
    def workflow(self, name):
        return (ROOT / ".github/workflows" / name).read_text()

    def test_one_publisher_waits_for_all_platforms(self):
        workflow = self.workflow("release.yml")
        self.assertIn('tags: ["v*"]', workflow)
        self.assertNotIn("paths:", workflow)
        for platform, filename in (
            ("windows", "desktop.yml"), ("macos", "macos.yml"), ("android", "android.yml")
        ):
            self.assertIn(f"uses: ./.github/workflows/{filename}", workflow)
            self.assertIn(platform, workflow.split("needs: [windows, macos, android]")[0])
        self.assertIn("needs: [windows, macos, android]", workflow)
        self.assertIn("python3 scripts/release.py publish", workflow)
        for filename in ("desktop.yml", "macos.yml", "android.yml"):
            build = self.workflow(filename)
            self.assertIn("workflow_call:", build)
            self.assertNotIn("gh release", build)
            self.assertNotIn("contents: write", build)
            self.assertNotIn('tags: ["v*"]', build)

    def test_windows_installer_is_self_contained_per_user_and_uninstallable(self):
        installer = (ROOT / "desktop/installer.iss").read_text()
        for text in (
            "PrivilegesRequired=lowest", r"DefaultDirName={localappdata}\SlopGrenade",
            r'DestDir: "{app}\bin"', r'DestDir: "{app}\web\build"',
            "Uninstallable=yes", "CloseApplications=yes", "RestartApplications=no",
            r'Filename: "{app}\bin\slop-grenade-overlay.exe"',
        ):
            self.assertIn(text, installer)
        workflow = self.workflow("desktop.yml")
        self.assertIn("ISCC.exe", workflow)
        self.assertIn("test-windows-installer.ps1", workflow)
        self.assertIn("slop-grenade-windows-x64-setup.exe.sha256", workflow)

    def test_macos_has_a_native_installer_not_just_an_archive(self):
        workflow = self.workflow("macos.yml")
        self.assertIn("pkgbuild", workflow)
        self.assertIn("--install-location /Applications", workflow)
        self.assertIn("slop-grenade-macos-universal.pkg.sha256", workflow)
        self.assertIn("test-macos-installer.sh", workflow)
        self.assertLess(workflow.index("test-macos-installer.sh"),
                        workflow.index("uses: actions/upload-artifact@"))

    def test_android_release_never_falls_back_to_debug_or_test_signing(self):
        workflow = self.workflow("android.yml").split("  release-apk:\n", 1)[1]
        self.assertIn("needs: compatibility", workflow)
        self.assertIn("if: inputs.release", workflow)
        self.assertIn("build-android.sh release", workflow)
        self.assertNotIn("build-android.sh debug", workflow)
        self.assertNotIn("secrets.SLOP_ANDROID_TEST_", workflow)
        for name in ("KEYSTORE_BASE64", "STORE_PASSWORD", "KEY_ALIAS", "KEY_PASSWORD"):
            self.assertIn("${{ secrets.SLOP_ANDROID_" + name + " }}", workflow)
        self.assertIn("if: always()", workflow)

    def test_user_docs_link_native_installers_for_all_supported_platforms(self):
        readme = (ROOT / "README.md").read_text()
        for name in ("slop-grenade-windows-x64-setup.exe",
                     "slop-grenade-macos-universal.pkg", "slop-grenade-android.apk"):
            self.assertIn("/releases/latest/download/" + name, readme)
        self.assertNotIn(r".\slop-grenade\install-local.ps1", readme)


if __name__ == "__main__":
    unittest.main()
