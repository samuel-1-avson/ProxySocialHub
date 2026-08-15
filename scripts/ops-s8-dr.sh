#!/usr/bin/env bash
# S8 DR: take a fresh backup (if needed), run restore drill into scratch DB,
# and record current IMAGE_TAG / running images for rollback readiness.
# Does NOT rollback live traffic. Does NOT restore over live DB.
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
cd "$PROJECT_DIR"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
OUT_DIR="$PROJECT_DIR/docs/ops/evidence"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/proxyhubb}"
mkdir -p "$OUT_DIR" "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
REPORT="$OUT_DIR/S8_dr_${STAMP}.md"
VERDICT="PASS"
NOTES=()

fail_note() { VERDICT="FAIL"; NOTES+=("$1"); }
warn_note() { NOTES+=("$1"); }

{
  echo "# S8 Disaster Recovery drill — $STAMP"
  echo
  echo "## 1. Current deploy identity"
  echo '```'
  grep -E '^IMAGE_TAG=' .env 2>/dev/null | sed 's/\r$//' || echo "IMAGE_TAG=(unset)"
  echo "--- running images ---"
  "${COMPOSE[@]}" images 2>/dev/null | head -40 || true
  echo "--- control-api image ---"
  cid=$("${COMPOSE[@]}" ps -q control-api 2>/dev/null | head -1 || true)
  if [[ -n "${cid:-}" ]]; then
    docker inspect "$cid" --format 'Image={{.Config.Image}} Created={{.Created}}' || true
  fi
  echo '```'
  echo

  echo "## 2. Postgres backup"
} >"$REPORT"

DUMP=""
LATEST=$(ls -1t "$BACKUP_DIR"/proxyhubb-*.dump 2>/dev/null | head -1 || true)
NEED_NEW=1
if [[ -n "$LATEST" ]]; then
  AGE=$(( $(date +%s) - $(stat -c %Y "$LATEST") ))
  if [[ "$AGE" -lt 86400 ]]; then
    NEED_NEW=0
    DUMP="$LATEST"
    echo "Using recent dump (<24h): $DUMP" | tee -a "$REPORT"
  fi
fi

if [[ "$NEED_NEW" -eq 1 ]]; then
  echo "Taking fresh backup via gcp-postgres-backup.sh..." | tee -a "$REPORT"
  if [[ -x scripts/gcp-postgres-backup.sh ]]; then
    if DOCKER=docker PROJECT_DIR="$PROJECT_DIR" BACKUP_DIR="$BACKUP_DIR" bash scripts/gcp-postgres-backup.sh >>"$REPORT" 2>&1; then
      DUMP=$(ls -1t "$BACKUP_DIR"/proxyhubb-*.dump 2>/dev/null | head -1 || true)
    else
      fail_note "backup script failed"
    fi
  else
    fail_note "missing scripts/gcp-postgres-backup.sh"
  fi
fi

{
  echo
  echo "| Dump | \`$DUMP\` |"
  echo
  echo "## 3. Restore drill (scratch DB only)"
  echo '```'
} >>"$REPORT"

if [[ -n "$DUMP" && -f "$DUMP" && -x scripts/gcp-postgres-restore-drill.sh ]]; then
  set +e
  bash scripts/gcp-postgres-restore-drill.sh "$DUMP" >>"$REPORT" 2>&1
  RC=$?
  set -e
  if [[ "$RC" -ne 0 ]]; then
    fail_note "restore drill exit $RC"
  fi
else
  fail_note "no dump or restore-drill script"
  echo "(skipped)" >>"$REPORT"
fi
echo '```' >>"$REPORT"

{
  echo
  echo "## 4. Rollback procedure (documented — not executed)"
  echo
  echo "Live rollback path (manual):"
  echo '```'
  echo "# 1) Identify previous known-good IMAGE_TAG from GHCR / prior evidence"
  echo "# 2) On VM:"
  echo "IMAGE_TAG=<previous> ./scripts/gcp-compose-pull-deploy.sh"
  echo "# Or web-only:"
  echo "IMAGE_TAG=<previous> ./scripts/gcp-deploy-web.sh"
  echo "# 3) Verify: ./scripts/gcp-verify-web-deploy.sh + /healthz"
  echo '```'
  echo
  echo "This drill records current tag/image identity so a rollback target can be chosen."
  echo "It does **not** flip traffic to an older tag (avoids accidental downgrade during triage)."
  echo
  echo "## Verdict"
  echo
  echo "| Verdict | **$VERDICT** |"
  if ((${#NOTES[@]})); then
    echo
    echo "### Notes"
    for n in "${NOTES[@]}"; do echo "- $n"; done
  fi
} >>"$REPORT"

echo "S8_REPORT=$REPORT"
echo "S8_VERDICT=$VERDICT"
echo S8_DR_DONE
