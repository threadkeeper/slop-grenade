"""Verify complete release assets and publish them together from a draft."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


PACKAGES = (
    "slop-grenade-windows-x64-setup.exe",
    "slop-grenade-windows-x64.zip",
    "slop-grenade-macos-universal.pkg",
    "slop-grenade-macos-universal.tar.gz",
    "slop-grenade-android.apk",
)


def version_from_tag(tag):
    """Accept only ordinary, non-preview semantic version tags."""
    if not re.fullmatch(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", tag):
        raise ValueError("Releases require a tag in the form vMAJOR.MINOR.PATCH.")
    return tag[1:]


def verify_assets(directory):
    """Require every installer, portable package and matching SHA-256 file."""
    expected = {name + suffix for name in PACKAGES for suffix in ("", ".sha256")}
    if {path.name for path in directory.iterdir()} != expected:
        raise ValueError("Release must contain exactly all Windows, macOS and Android packages and checksums.")
    digests = {}
    for name in sorted(expected):
        path = directory / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f"Release asset must be a nonempty regular file: {name}")
        with path.open("rb") as stream:
            digests[name] = hashlib.file_digest(stream, "sha256").hexdigest()
    for name in PACKAGES:
        checksum = (directory / (name + ".sha256")).read_text(encoding="ascii").strip()
        if checksum != f"{digests[name]}  {name}":
            raise ValueError(f"SHA-256 checksum or filename does not match: {name}")
    return digests


def gh(*arguments):
    """Run GitHub CLI without concealing authentication or network failures."""
    return subprocess.run(
        ["gh", *arguments], check=True, text=True, stdout=subprocess.PIPE,
    ).stdout


def publish(tag, directory):
    """Upload to a draft, check the remote inventory, then publish atomically."""
    version_from_tag(tag)
    digests = verify_assets(directory)
    releases = json.loads(gh("release", "list", "--limit", "1000", "--json", "tagName,isDraft"))
    existing = next((item for item in releases if item["tagName"] == tag), None)
    if existing is not None and not existing["isDraft"]:
        raise ValueError("Refusing to overwrite an already published release.")
    if existing is None:
        notes = f"""Windows, macOS and Android packages built together from {tag}.

## Install
- Windows 10/11 (x64): download and open `slop-grenade-windows-x64-setup.exe`.
- macOS 13+ (Apple Silicon and Intel): download and open `slop-grenade-macos-universal.pkg`, then open Slop Grenade from Applications.
- Android 11+: download and open `slop-grenade-android.apk`.

The desktop installers include the app, background service and dashboard. No build tools or source checkout are needed.
Portable desktop archives are also included. Every download has an adjacent SHA-256 checksum file.

## Signing and account setup
The Windows installer is not Authenticode-signed. The macOS app is ad-hoc signed; its installer is not Developer ID-signed or notarized. Windows SmartScreen or macOS Gatekeeper may require explicit approval.
Android uses the configured release signing key, never a debug or OAuth test key.
Microsoft 365 requires the local WorkIQ CLI and user sign-in. Gmail requires Google OAuth approval and registration matching the app and Android signing certificate. Installing the app does not grant account access.
"""
        gh("release", "create", tag, "--verify-tag", "--draft",
           "--title", f"Slop Grenade {tag}", "--notes", notes)
    gh("release", "upload", tag, *(str(directory / name) for name in sorted(digests)), "--clobber")
    remote = json.loads(gh("release", "view", tag, "--json", "isDraft,assets"))
    assets = remote["assets"]
    if not remote["isDraft"] or len(assets) != len(digests) or {asset["name"] for asset in assets} != set(digests):
        raise ValueError("Remote draft does not contain exactly the complete release asset set.")
    for asset in assets:
        name = asset["name"]
        if asset["digest"] != "sha256:" + digests[name] or asset["size"] != (directory / name).stat().st_size:
            raise ValueError(f"Remote release asset does not match the verified build: {name}")
    gh("release", "edit", tag, "--draft=false", "--latest")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("validate-tag", "verify", "publish"))
    parser.add_argument("value", help="Version tag, or asset directory for verify")
    parser.add_argument("directory", nargs="?", type=Path)
    args = parser.parse_args()
    if args.command == "validate-tag":
        version_from_tag(args.value)
    elif args.command == "verify":
        verify_assets(Path(args.value))
    else:
        if args.directory is None:
            parser.error("publish requires an asset directory")
        publish(args.value, args.directory)


if __name__ == "__main__":
    main()
