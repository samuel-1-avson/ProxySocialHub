#!/usr/bin/env bash
# Verify ProxyHubb Postgres backups are configured and (optionally) healthy.
#
# Usage (on the GCE VM):
#   ./scripts/gcp-postgres-backup-verify.sh
#   ./scripts/gcp-postgres-backup-verify.sh --run-drill
#
# Exit 0 only if cron, local dump freshness, and optional GCS/object checks pass.

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/proxyhubb}"
GCS_BACKUP_BUCKET="${GCS_BACKUP_BUCKET:-}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-36}"
DOCKER="${DOCKER:-docker}"
RUN_DRILL=0
FAILS=0

for arg in "$@"; do
  case "$arg" in
    --run-drill) RUN_DRILL=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [ -z "$GCS_BACKUP_BUCKET" ] && [ -f "$PROJECT_DIR/.env" ]; then
  GCS_BACKUP_BUCKET="$(grep -E '^GCS_BACKUP_BUCKET=' "$PROJECT_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
fi

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }
warn() { echo "WARN  $*"; }

echo "=== ProxyHubb Postgres backup verification ==="
echo "PROJECT_DIR=$PROJECT_DIR"
echo "BACKUP_DIR=$BACKUP_DIR"
echo "GCS_BACKUP_BUCKET=${GCS_BACKUP_BUCKET:-"(unset)"}"
echo ""

if [ -x "$PROJECT_DIR/scripts/gcp-postgres-backup.sh" ]; then
  pass "backup script present"
else
  fail "missing $PROJECT_DIR/scripts/gcp-postgres-backup.sh"
fi

if [ -x "$PROJECT_DIR/scripts/gcp-postgres-restore-drill.sh" ]; then
  pass "restore drill script present"
else
  fail "missing $PROJECT_DIR/scripts/gcp-postgres-restore-drill.sh"
fi

if [ -f /etc/cron.d/proxyhubb-postgres-backup ]; then
  pass "cron installed (/etc/cron.d/proxyhubb-postgres-backup)"
  grep -v '^#' /etc/cron.d/proxyhubb-postgres-backup | grep -q gcp-postgres-backup \
    && pass "cron points at backup script" \
    || fail "cron file does not invoke gcp-postgres-backup.sh"
else
  fail "cron not installed — run sudo ./scripts/gcp-postgres-backup-install.sh"
fi

if [ -d "$BACKUP_DIR" ]; then
  pass "backup directory exists"
else
  fail "backup directory missing: $BACKUP_DIR"
fi

LATEST="$(ls -1t "$BACKUP_DIR"/proxyhubb-*.dump 2>/dev/null | head -1 || true)"
if [ -n "$LATEST" ]; then
  pass "local dump found: $LATEST"
  SIZE="$(wc -c < "$LATEST" | tr -d ' ')"
  MAGIC="$(head -c 5 "$LATEST" | tr -d '\0' || true)"
  if [ "$SIZE" -ge 1024 ] && [ "$MAGIC" = "PGDMP" ]; then
    pass "dump looks like valid pg_dump -Fc (${SIZE} bytes)"
  else
    fail "dump invalid (size=${SIZE}, magic='${MAGIC}')"
  fi
  if [ -f "${LATEST}.sha256" ]; then
    if (cd "$(dirname "$LATEST")" && sha256sum -c "$(basename "$LATEST").sha256" >/dev/null); then
      pass "sha256 checksum ok"
    else
      fail "sha256 checksum mismatch"
    fi
  else
    warn "no .sha256 sidecar for latest dump"
  fi
  # portable age check (GNU find -mmin)
  if find "$LATEST" -mmin "-$((MAX_AGE_HOURS * 60))" | grep -q .; then
    pass "latest dump younger than ${MAX_AGE_HOURS}h"
  else
    fail "latest dump older than ${MAX_AGE_HOURS}h — cron may be broken"
  fi
else
  fail "no local dumps in $BACKUP_DIR — run ./scripts/gcp-postgres-backup.sh"
fi

if [ -n "$GCS_BACKUP_BUCKET" ]; then
  if command -v gcloud >/dev/null 2>&1; then
    OBJ_COUNT="$(gcloud storage ls "gs://${GCS_BACKUP_BUCKET}/postgres/" 2>/dev/null | grep -c '\.dump$' || true)"
    if [ "${OBJ_COUNT:-0}" -gt 0 ]; then
      pass "GCS has ${OBJ_COUNT} dump object(s) in gs://${GCS_BACKUP_BUCKET}/postgres/"
    else
      fail "GCS bucket set but no dumps under gs://${GCS_BACKUP_BUCKET}/postgres/"
    fi
  else
    warn "gcloud missing — skipping GCS object check"
  fi
else
  warn "GCS_BACKUP_BUCKET unset — backups are local-only (disk failure = data loss)"
fi

# Snapshot policy hint (host-side; may need gcloud auth)
if command -v gcloud >/dev/null 2>&1; then
  ZONE="${GCP_ZONE:-$(curl -sf -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/zone 2>/dev/null | awk -F/ '{print $NF}' || true)}"
  INST="${GCP_INSTANCE:-$(curl -sf -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/name 2>/dev/null || true)}"
  if [ -n "$ZONE" ] && [ -n "$INST" ]; then
    DISK="$(gcloud compute instances describe "$INST" --zone="$ZONE" --format='value(disks[0].source)' 2>/dev/null | awk -F/ '{print $NF}' || true)"
    if [ -n "$DISK" ]; then
      POLICIES="$(gcloud compute disks describe "$DISK" --zone="$ZONE" --format='value(resourcePolicies)' 2>/dev/null || true)"
      if [ -n "$POLICIES" ]; then
        pass "boot disk has snapshot policy: $POLICIES"
      else
        fail "boot disk has no snapshot schedule — run ./scripts/gcp-testnet-provision-backups.sh"
      fi
    fi
  fi
fi

if [ "$RUN_DRILL" -eq 1 ]; then
  if [ -z "${LATEST:-}" ]; then
    fail "cannot run drill without a local dump"
  else
    echo ""
    echo "=== Running restore drill ==="
    DOCKER="$DOCKER" PROJECT_DIR="$PROJECT_DIR" \
      "$PROJECT_DIR/scripts/gcp-postgres-restore-drill.sh" "$LATEST" \
      && pass "restore drill succeeded" \
      || fail "restore drill failed"
  fi
fi

echo ""
if [ "$FAILS" -eq 0 ]; then
  echo "RESULT: OK"
  exit 0
fi
echo "RESULT: ${FAILS} check(s) failed"
exit 1
