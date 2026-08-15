#!/usr/bin/env bash
# Finish 0.6: off-box quarantine keys to Secret Manager, shred on-VM copies.
set -euo pipefail

PROJECT="${GCP_PROJECT:-gen-lang-client-0022105784}"
QDIR="/opt/proxyhubb/secrets/quarantine-20260807"
ORACLE_SRC="$QDIR/oracle-keypair.json"
HOT_SRC="$QDIR/treasury-hot-keypair.json"
COLD_SRC="/opt/proxyhubb/secrets/treasury-cold-keypair.json"

echo "== verify KMS still healthy =="
sudo docker logs proxyhubb-control-api-1 2>&1 | grep -E "Initialized GCP Cloud KMS" | tail -4

echo "== off-box oracle to Secret Manager =="
if [ -f "$ORACLE_SRC" ]; then
  if ! gcloud secrets describe proxyhubb-testnet-oracle-keypair --project="$PROJECT" >/dev/null 2>&1; then
    gcloud secrets create proxyhubb-testnet-oracle-keypair \
      --project="$PROJECT" \
      --replication-policy=automatic
  fi
  # New version from quarantine file (idempotent if content matches prior).
  sudo cat "$ORACLE_SRC" | gcloud secrets versions add proxyhubb-testnet-oracle-keypair \
    --project="$PROJECT" \
    --data-file=-
  echo "oracle_secret=proxyhubb-testnet-oracle-keypair"
else
  echo "WARN: oracle quarantine file missing"
fi

echo "== confirm hot secret exists =="
gcloud secrets versions list proxyhubb-testnet-treasury-hot-keypair --project="$PROJECT" --limit=1

echo "== confirm cold secret exists =="
gcloud secrets versions list proxyhubb-testnet-treasury-cold-keypair --project="$PROJECT" --limit=1

shred_rm() {
  local f="$1"
  if [ ! -f "$f" ]; then
    echo "skip missing $f"
    return 0
  fi
  if command -v shred >/dev/null 2>&1; then
    sudo shred -u -n 3 -z "$f"
  else
    # Fallback overwrite then unlink
    sudo dd if=/dev/urandom of="$f" bs=4096 count=1 conv=notrunc status=none 2>/dev/null || true
    sudo rm -f "$f"
  fi
  echo "shredded $f"
}

echo "== shred quarantine + cold on-VM path =="
shred_rm "$ORACLE_SRC"
shred_rm "$HOT_SRC"
shred_rm "$COLD_SRC"
# Remove empty quarantine dir
if [ -d "$QDIR" ]; then
  sudo rmdir "$QDIR" 2>/dev/null || sudo rm -rf "$QDIR"
fi

echo "== assert gone =="
test ! -f "$ORACLE_SRC"
test ! -f "$HOT_SRC"
test ! -f "$COLD_SRC"
test ! -d "$QDIR" || { echo "quarantine dir still present"; ls -la "$QDIR" || true; exit 1; }
# No live oracle/hot JSON under app tree (examples OK)
if sudo find /opt/proxyhubb -type f \( -name 'oracle-keypair.json' -o -name 'treasury-hot-keypair.json' -o -name 'treasury-cold-keypair.json' \) 2>/dev/null | grep -v example; then
  echo "FAIL: keypair JSON still under /opt/proxyhubb"
  exit 1
fi

echo "== control-api still healthy =="
st=$(sudo docker inspect proxyhubb-control-api-1 --format '{{.State.Health.Status}}')
echo "health=$st"
test "$st" = "healthy"

echo "SPRINT_06_KEYS_OFFBOX_OK"
