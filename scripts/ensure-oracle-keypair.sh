#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${REPO_ROOT}/infra/oracle-keypair.json"
EXAMPLE="${REPO_ROOT}/infra/oracle-keypair.json.example"

if [[ -f "$TARGET" ]]; then
  echo "Oracle keypair present: $TARGET"
  exit 0
fi

if [[ ! -f "$EXAMPLE" ]]; then
  echo "Missing $EXAMPLE" >&2
  exit 1
fi

cp "$EXAMPLE" "$TARGET"
echo "Created placeholder oracle keypair at $TARGET (replace before production/devnet funds)."
