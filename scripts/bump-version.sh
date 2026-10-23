#!/usr/bin/env sh
set -eu

KIND="${1:-fix}"
CURRENT="$(tr -d '[:space:]' < VERSION)"
IFS='.' read -r MAJOR MINOR PATCH <<EOF
$CURRENT
EOF

case "$KIND" in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  feature)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  fix|*)
    PATCH=$((PATCH + 1))
    ;;
esac

printf "%s.%s.%s\n" "$MAJOR" "$MINOR" "$PATCH" > VERSION
