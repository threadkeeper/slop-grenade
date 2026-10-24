#!/usr/bin/env bash
set -euo pipefail
[[ $# == 1 && -f "$1" ]] || { printf '%s\n' "Expected one existing artifact file." >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -- "$1"
else
  shasum -a 256 -- "$1"
fi
