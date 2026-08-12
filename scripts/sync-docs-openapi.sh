#!/usr/bin/env bash
# Sync docs/openapi.yaml → apps/docs/public/openapi.yaml (authoritative → published).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SRC="$PROJECT_DIR/docs/openapi.yaml"
DEST="$PROJECT_DIR/apps/docs/public/openapi.yaml"

if [[ ! -f "$SRC" ]]; then
  echo "ERROR: missing $SRC" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
cp -f "$SRC" "$DEST"
echo "Synced openapi.yaml → apps/docs/public/openapi.yaml ($(wc -c < "$DEST") bytes)"
