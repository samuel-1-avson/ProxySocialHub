#!/usr/bin/env bash
# ==============================================================================
# ProxyHubb pre-deploy database backup (GCP testnet VM)
#
# Takes a compressed pg_dump of the testnet database before a manual deploy and
# keeps only the newest BACKUP_KEEP dumps, so backups cannot slowly fill the
# 80 GB disk (each dump is about 0.6 GB). The old dumps are removed only after
# the new one has been written and verified, and only files named
# pre-deploy-*.dump in BACKUP_DIR are ever touched.
#
# Usage (on the VM):
#   bash scripts/gcp-pre-deploy-backup.sh
#
# Environment:
#   BACKUP_DIR          where dumps go                 (default /var/backups/proxyhubb-db)
#   BACKUP_KEEP         how many dumps to keep, >= 1   (default 3)
#   BACKUP_MIN_FREE_GB  refuse to start below this     (default 3)
#   PG_CONTAINER        the Postgres container         (default proxyhubb-postgres-1)
#
# Restore, if ever needed (into an EMPTY database; this is not part of the script):
#   sudo docker exec -i proxyhubb-postgres-1 pg_restore -U proxyhubb -d <new_db> --no-owner < <dump>
# ==============================================================================

set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/var/backups/proxyhubb-db}
BACKUP_KEEP=${BACKUP_KEEP:-3}
BACKUP_MIN_FREE_GB=${BACKUP_MIN_FREE_GB:-3}
PG_CONTAINER=${PG_CONTAINER:-proxyhubb-postgres-1}

if ! [[ "$BACKUP_KEEP" =~ ^[0-9]+$ ]] || (( BACKUP_KEEP < 1 )); then
  echo "BACKUP_KEEP must be a whole number >= 1 (got '$BACKUP_KEEP'); refusing to run so the newest backup can never be removed." >&2
  exit 1
fi

free_gb() {
  df -BG --output=avail / 2>/dev/null | tail -n 1 | tr -dc '0-9' || true
}

FREE=$(free_gb)
echo "Free disk: ${FREE:-unknown}${FREE:+ GB}"
if [[ -n "$FREE" ]] && (( FREE < BACKUP_MIN_FREE_GB )); then
  echo "❌ Only ${FREE} GB free (need ${BACKUP_MIN_FREE_GB} GB for a dump). No backup was taken and nothing was removed." >&2
  exit 1
fi

TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_DIR/pre-deploy-$TS.dump"
TMP="$BACKUP_DIR/.pre-deploy-$TS.dump.partial"

sudo mkdir -p "$BACKUP_DIR"
sudo chmod 700 "$BACKUP_DIR"

echo "Dumping the database to $OUT ..."
if ! sudo sh -c "docker exec '$PG_CONTAINER' sh -c 'pg_dump -U \"\${POSTGRES_USER:-proxyhubb}\" -d \"\${POSTGRES_DB:-proxyhubb}\" -Fc' > '$TMP'"; then
  sudo rm -f "$TMP"
  echo "❌ pg_dump failed. No backup was kept and no older backup was removed." >&2
  exit 1
fi

# A dump that cannot be listed back is not a backup.
ENTRIES=$(sudo cat "$TMP" | sudo docker exec -i "$PG_CONTAINER" pg_restore -l 2>/dev/null | grep -c ';' || true)
if ! [[ "$ENTRIES" =~ ^[0-9]+$ ]] || (( ENTRIES < 1 )); then
  sudo rm -f "$TMP"
  echo "❌ The new dump could not be read back (0 entries). It was discarded and no older backup was removed." >&2
  exit 1
fi

sudo mv "$TMP" "$OUT"
sudo chmod 600 "$OUT"
echo "Backup written: $OUT ($(sudo stat -c %s "$OUT" 2>/dev/null || echo '?') bytes, $ENTRIES entries)"

# Keep the newest BACKUP_KEEP dumps (names sort by timestamp); remove the rest.
REMOVED=0
while IFS= read -r old; do
  [[ -n "$old" ]] || continue
  sudo rm -f -- "$old"
  echo "Removed old backup: $old"
  REMOVED=$((REMOVED + 1))
done < <(sudo find "$BACKUP_DIR" -maxdepth 1 -type f -name 'pre-deploy-*.dump' | sort -r | tail -n +"$((BACKUP_KEEP + 1))")

echo "Kept $(sudo find "$BACKUP_DIR" -maxdepth 1 -type f -name 'pre-deploy-*.dump' | wc -l) backup(s) (limit $BACKUP_KEEP), removed $REMOVED."
echo "Free disk: $(free_gb) GB"
echo "BACKUP_OK $OUT"
