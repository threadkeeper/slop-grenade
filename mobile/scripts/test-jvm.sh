#!/usr/bin/env bash
set -euo pipefail
mobile="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$mobile/gradlew" -p "$mobile/jvm-tests" :gmail:test test --no-daemon "$@"
