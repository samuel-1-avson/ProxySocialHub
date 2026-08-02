#!/usr/bin/env bash
# Fail if SQL reappears under the obsolete control-api migrations path (MIG-02).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHADOW="$ROOT/services/control-api/migrations"
if [[ ! -d "$SHADOW" ]]; then
  echo "OK: no shadow migrations directory"
  exit 0
fi
hits=$(find "$SHADOW" -type f -name '*.sql' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$hits" != "0" ]]; then
  echo "ERROR: found $hits *.sql under services/control-api/migrations/ (MIG-02)" >&2
  find "$SHADOW" -type f -name '*.sql' >&2
  echo "Move to docs/ops/supabase-manual/ or promote into root migrations/." >&2
  exit 1
fi
echo "OK: no shadow *.sql under services/control-api/migrations/"
