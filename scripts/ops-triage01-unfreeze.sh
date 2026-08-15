#!/usr/bin/env bash
# Resolve open user_flags so withdrawals are unfrozen.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
UID_S="${1:-b77e84c9-0e85-4f23-afc0-581cd561c216}"
OUT=docs/ops/evidence
mkdir -p "$OUT"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
REPORT="$OUT/TRIAGE01_unfreeze_${STAMP}.md"

psql() { "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 "$@"; }

{
  echo "# TRIAGE-01 unfreeze — $STAMP"
  echo "| user | \`$UID_S\` |"
  echo
  echo "## Before"
  echo '```'
  psql -c "SELECT id, user_id, flag_type, reason, resolved, created_at FROM user_flags WHERE user_id='$UID_S'::uuid ORDER BY created_at DESC;"
  echo '```'
} >"$REPORT"

OPEN=$(psql -At -c "SELECT COUNT(*) FROM user_flags WHERE user_id='$UID_S'::uuid AND resolved=false;" | tr -d '\r')
echo "open_flags=$OPEN" | tee -a "$REPORT"

psql -c "UPDATE user_flags SET resolved=true, updated_at=NOW() WHERE user_id='$UID_S'::uuid AND resolved=false;" >>"$REPORT" 2>&1 || \
psql -c "UPDATE user_flags SET resolved=true WHERE user_id='$UID_S'::uuid AND resolved=false;" >>"$REPORT" 2>&1

{
  echo
  echo "## After"
  echo '```'
  psql -c "SELECT id, flag_type, resolved, created_at FROM user_flags WHERE user_id='$UID_S'::uuid ORDER BY created_at DESC;"
  echo '```'
  echo
  echo "| Verdict | **CLEARED** (resolved=true on open flags) |"
} >>"$REPORT"

echo "UNFREEZE_REPORT=$REPORT"
echo UNFREEZE_DONE
