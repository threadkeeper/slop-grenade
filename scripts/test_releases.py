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
        for tag in ("", "main", "v1.2", "v01.2.3", "v1.2.3-preview",
                    "v1.2.3-experimental", "v1.2.3\n", "v1.2.3;echo injected",
                    "$(echo injected)", "v1.2.3/../main", "v1.2.3\nTAG=main"):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                release.version_from_tag(tag)

    def run_publisher(self, existing=None, remote_change=None, target=None, tag_objects=None,
                      commands=None):
        if commands is None:
            commands = []
        expected = release.verify_assets(self.assets)

        def gh(*args):
            commands.append(args)
            if args[0] == "api":
                if tag_objects is None:
                    raise subprocess.CalledProcessError(
                        1, "gh", stderr="gh: Not Found (HTTP 404)")
                result = tag_objects[len([cmd for cmd in commands if cmd[0] == "api"]) - 1]
                if isinstance(result, Exception):
                    raise result
                return json.dumps(result)
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
            release.publish("v1.2.3", self.assets, target=target)
        return commands

    def test_target_creates_missing_tag_at_exact_sha(self):
        target = "a" * 40
        commands = self.run_publisher(target=target)
        create = next(cmd for cmd in commands if cmd[:2] == ("release", "create"))
        self.assertIn("--target", create)
        self.assertEqual(create[create.index("--target") + 1], target)
        self.assertNotIn("--verify-tag", create)
        self.assertEqual(commands[0], (
            "api", "repos/{owner}/{repo}/git/ref/tags/v1.2.3"))
        self.assertEqual(commands[-2], commands[0])
        self.assertEqual(commands[-1][-2:], ("--target", target))

    def test_target_resumes_draft_at_exact_sha_but_refuses_public_release(self):
        target = "a" * 40
        commands = self.run_publisher(
            existing={"tagName": "v1.2.3", "isDraft": True}, target=target)
        self.assertNotIn("create", [cmd[1] for cmd in commands])
        self.assertEqual(commands[-1][-2:], ("--target", target))
        with patch.object(release, "gh") as gh:
            gh.side_effect = [
                json.dumps({"object": {"type": "commit", "sha": target}}),
                json.dumps([{"tagName": "v1.2.3", "isDraft": False}]),
            ]
            with self.assertRaises(ValueError):
                release.publish("v1.2.3", self.assets, target=target)
            self.assertEqual(gh.call_count, 2)

    def test_cli_passes_target_and_rejects_injection_tags_without_api_calls(self):
        target = "a" * 40
        with patch("sys.argv", ["release.py", "publish", "v1.2.3", str(self.assets),
                                "--target", target]), patch.object(release, "publish") as publish:
            release.main()
            publish.assert_called_once_with("v1.2.3", self.assets, target=target)
        with patch.object(release, "gh") as gh:
            for tag in ("v1.2.3;echo injected", "$(echo injected)", "v1.2.3\n"):
                with self.subTest(tag=tag), self.assertRaises(ValueError):
                    release.publish(tag, self.assets, target=target)
            gh.assert_not_called()

    def test_existing_lightweight_and_annotated_tags_must_match_target(self):
        target = "a" * 40
        for objects in (
            [{"object": {"type": "commit", "sha": target}}],
            [{"object": {"type": "tag", "sha": "b" * 40}},
             {"object": {"type": "tag", "sha": "c" * 40}},
             {"object": {"type": "commit", "sha": target}}],
        ):
            with self.subTest(objects=objects):
                commands = self.run_publisher(target=target, tag_objects=objects + objects)
                self.assertIn("edit", [cmd[1] for cmd in commands])
                self.assertEqual(commands[-2][0], "api")
                if len(objects) > 1:
                    self.assertIn(("api", "repos/{owner}/{repo}/git/tags/" + "b" * 40), commands)

    def test_tag_created_or_moved_during_upload_prevents_publication(self):
        target = "a" * 40
        for initial in (
            subprocess.CalledProcessError(1, "gh", stderr="gh: Not Found (HTTP 404)"),
            {"object": {"type": "commit", "sha": target}},
        ):
            with self.subTest(initial=initial):
                commands = []
                with self.assertRaisesRegex(ValueError, "triggering source SHA"):
                    self.run_publisher(
                        target=target,
                        tag_objects=[initial, {"object": {"type": "commit", "sha": "b" * 40}}],
                        commands=commands,
                    )
                self.assertIn("upload", [cmd[1] for cmd in commands])
                self.assertEqual(commands[-2][:2], ("release", "view"))
                self.assertEqual(commands[-1], (
                    "api", "repos/{owner}/{repo}/git/ref/tags/v1.2.3"))
                self.assertFalse(any(cmd[:2] == ("release", "edit") for cmd in commands))

    def test_tag_mismatch_and_lookup_errors_never_mutate_release(self):
        for objects in (
            [{"object": {"type": "commit", "sha": "b" * 40}}],
            [{"object": {"type": "tag", "sha": "b" * 40}},
             {"object": {"type": "commit", "sha": "c" * 40}}],
            [{"object": {"type": "tag", "sha": "b" * 40}},
             {"object": {"type": "tag", "sha": "b" * 40}}],
            [{"object": {"type": "blob", "sha": "b" * 40}}],
            [subprocess.CalledProcessError(1, "gh", stderr="HTTP 401")],
            [subprocess.CalledProcessError(1, "gh", stderr="HTTP 403")],
            [subprocess.CalledProcessError(1, "gh", stderr="HTTP 500")],
            [subprocess.CalledProcessError(1, "gh", stderr="network unavailable")],
            [{"object": {"type": "tag", "sha": "b" * 40}},
             subprocess.CalledProcessError(1, "gh", stderr="gh: Not Found (HTTP 404)")],
        ):
            with self.subTest(objects=objects):
                calls = []

                def gh(*args):
                    calls.append(args)
                    result = objects[len(calls) - 1]
                    if isinstance(result, Exception):
                        raise result
                    return json.dumps(result)

                with patch.object(release, "gh", side_effect=gh):
                    with self.assertRaises((ValueError, subprocess.CalledProcessError)):
                        release.publish("v1.2.3", self.assets, target="a" * 40)
                self.assertTrue(all(cmd[0] == "api" for cmd in calls))

    def test_invalid_target_or_assets_prevent_all_github_calls(self):
        with patch.object(release, "gh") as gh:
            for target in ("main", "--target=main", "a" * 39, "a" * 40 + "\n"):
                with self.subTest(target=target), self.assertRaises(ValueError):
                    release.publish("v1.2.3", self.assets, target=target)
            (self.assets / release.PACKAGES[0]).unlink()
            with self.assertRaises(ValueError):
                release.publish("v1.2.3", self.assets, target="a" * 40)
            gh.assert_not_called()

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
            for target in (None, "a" * 40):
                with self.subTest(change=change, target=target), self.assertRaises(ValueError):
                    self.run_publisher(remote_change=change, target=target)

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

    def test_manual_dispatch_validates_required_input_and_exports_tag(self):
        workflow = self.workflow("release.yml")
        validate = workflow.split("  validate:\n", 1)[1].split("\n  windows:", 1)[0]
        self.assertIn("  workflow_dispatch:\n    inputs:\n      tag:", workflow)
        for text in ("required: true", "type: string", "vMAJOR.MINOR.PATCH"):
            self.assertIn(text, workflow.split("permissions:", 1)[0])
        self.assertIn("tag: ${{ steps.version.outputs.tag }}", validate)
        self.assertIn("id: version", validate)
        self.assertIn("TAG: ${{ github.event_name == 'push' && github.ref_name || inputs.tag }}", validate)
        self.assertIn('python3 scripts/release.py validate-tag "$TAG"', validate)
        self.assertIn('printf \'tag=%s\\n\' "$TAG" >> "$GITHUB_OUTPUT"', validate)
        self.assertLess(validate.index('validate-tag "$TAG"'), validate.index('>> "$GITHUB_OUTPUT"'))
        self.assertNotIn("if: github.ref_type", workflow)
        self.assertNotIn("${{ inputs.tag }}", validate.split("run: |", 1)[1])
        self.assertIn(
            "- name: Release policy regression tests\n"
            "        run: python3 -m unittest discover -s scripts -p 'test_releases.py'",
            validate,
        )

    def test_builds_and_publication_require_validation_and_successful_dependencies(self):
        workflow = self.workflow("release.yml")
        for job, needs in (
            ("windows", "validate"), ("macos", "validate"), ("android", "validate"),
            ("publish", "[validate, windows, macos, android]"),
        ):
            with self.subTest(job=job):
                self.assertIn(
                    f"  {job}:\n"
                    f"    needs: {needs}\n",
                    workflow,
                )
        self.assertIn("TAG: ${{ needs.validate.outputs.tag }}", workflow)
        self.assertEqual(workflow.count("release_tag: ${{ needs.validate.outputs.tag }}"), 3)
        self.assertIn('publish "$TAG" release-assets --target "$SOURCE_SHA"', workflow)
        self.assertIn("SOURCE_SHA: ${{ github.sha }}", workflow)
        self.assertIn("group: release-${{ github.event_name == 'push' && github.ref_name || inputs.tag }}", workflow)
        self.assertNotIn("always()", workflow)

    def test_all_checkouts_use_trigger_sha_and_reusable_version_input_is_optional(self):
        for name in ("release.yml", "desktop.yml", "macos.yml", "android.yml"):
            workflow = self.workflow(name)
            self.assertEqual(workflow.count("uses: actions/checkout@"),
                             workflow.count("ref: ${{ github.sha }}"))
            if name != "release.yml":
                self.assertIn("      release_tag:\n", workflow)
                self.assertIn("required: false", workflow)
                self.assertIn("RELEASE_TAG: ${{ inputs.release_tag }}", workflow)
                self.assertIn("validate-tag", workflow)
        for name, prefix in (("macos.yml", "macos"), ("android.yml", "android")):
            self.assertIn(
                f"group: {prefix}-${{{{ github.workflow }}}}-${{{{ inputs.release_tag || github.ref }}}}",
                self.workflow(name))
        self.assertIn('VERSION="${RELEASE_TAG#v}"', self.workflow("macos.yml"))
        self.assertIn("$env:RELEASE_TAG.Substring(1)", self.workflow("desktop.yml"))
        self.assertIn('SLOP_ANDROID_VERSION_NAME="${RELEASE_TAG#v}"', self.workflow("android.yml"))
        gradle = (ROOT / "mobile/app/build.gradle.kts").read_text()
        self.assertIn('System.getenv("SLOP_ANDROID_VERSION_NAME") ?: "0.3.0"', gradle)

    def test_one_publisher_waits_for_all_platforms(self):
        workflow = self.workflow("release.yml")
        self.assertIn('tags: ["v*"]', workflow)
        self.assertNotIn("paths:", workflow)
        for platform, filename in (
            ("windows", "desktop.yml"), ("macos", "macos.yml"), ("android", "android.yml")
        ):
            self.assertIn(f"uses: ./.github/workflows/{filename}", workflow)
            self.assertIn(platform, workflow.split("needs: [validate, windows, macos, android]")[0])
        self.assertIn("needs: [validate, windows, macos, android]", workflow)
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
