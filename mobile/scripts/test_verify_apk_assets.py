"""Synthetic ZIP tests for dashboard asset packaging, not APK signing."""

import tempfile
import unittest
import zipfile
from pathlib import Path

from verify_apk_assets import verify_dashboard_assets


class DashboardAssetTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="slop-dashboard-assets-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.assets = self.root / "assets"
        self.archive = self.root / "synthetic-dashboard.zip"
        self.files = {
            "index.html": b'<script src="/_app/start.js"></script>',
            "_app/start.js": b"console.log('synthetic fixture');",
            "_app/styles.css": b"body { color: purple; }",
        }
        for name, content in self.files.items():
            destination = self.assets / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)

    def write_archive(self, files=None):
        with zipfile.ZipFile(self.archive, "w") as archive:
            for name, content in (self.files if files is None else files).items():
                archive.writestr("assets/" + name, content)

    def test_complete_dashboard_includes_underscore_directory(self):
        self.write_archive()
        self.assertEqual(verify_dashboard_assets(self.archive, self.assets), 3)

    def test_default_aapt_underscore_omission_is_rejected(self):
        self.write_archive({"index.html": self.files["index.html"]})
        with self.assertRaisesRegex(ValueError, "missing from APK: assets/_app/start.js"):
            verify_dashboard_assets(self.archive, self.assets)

    def test_changed_javascript_is_rejected(self):
        files = dict(self.files)
        files["_app/start.js"] = b"incorrect synthetic fixture"
        self.write_archive(files)
        with self.assertRaisesRegex(ValueError, "changed in APK: assets/_app/start.js"):
            verify_dashboard_assets(self.archive, self.assets)

    def test_missing_stylesheet_is_rejected(self):
        files = dict(self.files)
        del files["_app/styles.css"]
        self.write_archive(files)
        with self.assertRaisesRegex(ValueError, "missing from APK: assets/_app/styles.css"):
            verify_dashboard_assets(self.archive, self.assets)

    def test_missing_source_index_is_rejected(self):
        self.write_archive()
        (self.assets / "index.html").unlink()
        with self.assertRaisesRegex(ValueError, "index.html is required"):
            verify_dashboard_assets(self.archive, self.assets)

    def test_missing_source_javascript_is_rejected(self):
        self.write_archive()
        (self.assets / "_app/start.js").unlink()
        with self.assertRaisesRegex(ValueError, "JavaScript bundle is required"):
            verify_dashboard_assets(self.archive, self.assets)

    def test_dependency_assets_do_not_hide_or_invalidate_dashboard(self):
        files = dict(self.files)
        files["dependency/config.json"] = b"{}"
        self.write_archive(files)
        self.assertEqual(verify_dashboard_assets(self.archive, self.assets), 3)


if __name__ == "__main__":
    unittest.main()
