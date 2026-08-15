#!/usr/bin/env bash
# Repair accidental directory at infra/oracle-keypair.json (docker bind-mount artifact).
# Prefer restoring from tmp_oracle.json or Secret Manager; never print secret material.
set -euo pipefail
cd /opt/proxyhubb
TARGET=infra/oracle-keypair.json
BACKUP_DIR=/opt/proxyhubb/secrets
mkdir -p "$BACKUP_DIR"

echo "=== pre ==="
ls -lad "$TARGET" || true

if [[ -d "$TARGET" ]]; then
  echo "removing directory mount artifact $TARGET"
  rm -rf "$TARGET"
fi

if [[ -f "$TARGET" ]]; then
  echo "file already present"
elif [[ -f /opt/proxyhubb/tmp_oracle.json ]]; then
  echo "restoring from tmp_oracle.json"
  cp /opt/proxyhubb/tmp_oracle.json "$TARGET"
  chmod 600 "$TARGET"
elif gcloud secrets versions access latest --secret=proxyhubb-oracle-keypair --project=gen-lang-client-0022105784 >/tmp/oracle-restore.json 2>/dev/null; then
  echo "restoring from Secret Manager proxyhubb-oracle-keypair"
  mv /tmp/oracle-restore.json "$TARGET"
  chmod 600 "$TARGET"
else
  # try alternate secret names
  for s in oracle-keypair proxyhubb-solana-oracle oracle-keypair-json; do
    if gcloud secrets versions access latest --secret="$s" --project=gen-lang-client-0022105784 >/tmp/oracle-restore.json 2>/dev/null; then
      echo "restoring from secret $s"
      mv /tmp/oracle-restore.json "$TARGET"
      chmod 600 "$TARGET"
      break
    fi
  done
fi

if [[ ! -f "$TARGET" ]]; then
  echo "FAIL: could not restore oracle keypair file"
  exit 1
fi

# validate JSON array length ~64
python3 - <<'PY'
import json
p="infra/oracle-keypair.json"
raw=json.load(open(p))
assert isinstance(raw, list) and len(raw) in (64, 32), f"unexpected key len {len(raw) if isinstance(raw,list) else type(raw)}"
print(f"oracle_keypair_ok len={len(raw)}")
PY

# pubkey via docker solana-keygen if available
set +e
PUB=$(docker run --rm -v "$PWD/$TARGET:/o.json:ro" --entrypoint solana-keygen solanalabs/solana:v1.18.26 pubkey /o.json 2>/dev/null | tr -d '\r')
set -e
echo "oracle_pubkey=${PUB:-unknown}"

echo "=== post ==="
ls -la "$TARGET"
echo ORACLE_KP_REPAIR_DONE
