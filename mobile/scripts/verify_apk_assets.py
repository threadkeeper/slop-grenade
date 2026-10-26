"""Verify that an APK contains the complete, unchanged shared dashboard."""

import argparse
from pathlib import Path
from zipfile import ZipFile


def verify_dashboard_assets(apk: Path, assets: Path) -> int:
    """Require every built dashboard asset to appear unchanged in the APK."""
    if not (assets / "index.html").is_file():
        raise ValueError("Built dashboard index.html is required.")
    files = sorted(path for path in assets.rglob("*") if path.is_file())
    if not any(path.suffix in (".js", ".mjs") for path in files):
        raise ValueError("Built dashboard JavaScript bundle is required.")
    with ZipFile(apk) as package:
        names = set(package.namelist())
        for source in files:
            name = "assets/" + source.relative_to(assets).as_posix()
            if name not in names:
                raise ValueError(f"Dashboard asset missing from APK: {name}")
            if package.read(name) != source.read_bytes():
                raise ValueError(f"Dashboard asset changed in APK: {name}")
    return len(files)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("assets", type=Path)
    arguments = parser.parse_args()
    count = verify_dashboard_assets(arguments.apk, arguments.assets)
    print(f"Verified {count} packaged dashboard assets byte for byte.")
