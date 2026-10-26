#!/usr/bin/env bash
set -euo pipefail
mobile="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source="${1:-$mobile/../web/build}"
[[ -f "$source/index.html" ]] || { printf '%s\n' "Missing web build index.html; build the shared web UI first." >&2; exit 1; }
destination="$mobile/app/src/main/assets"
mkdir -p "$destination"
# Only remove the generated asset tree owned by this script.
find "$destination" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -R -- "$source/." "$destination/"
printf '%s\n' "Bundled dashboard assets."
