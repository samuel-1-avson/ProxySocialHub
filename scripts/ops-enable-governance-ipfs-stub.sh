#!/usr/bin/env bash
# Enable GOVERNANCE_IPFS_STUB on gcp-testnet so proposals can be created without Pinata.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

if grep -q '^GOVERNANCE_IPFS_STUB=' .env 2>/dev/null; then
  sed -i 's/^GOVERNANCE_IPFS_STUB=.*/GOVERNANCE_IPFS_STUB=1/' .env
else
  echo 'GOVERNANCE_IPFS_STUB=1' >> .env
fi
# Ensure compose passes it through if listed in env_file only — .env is enough for compose interpolation
grep -E '^GOVERNANCE_IPFS_STUB=' .env

# Confirm control-api compose env includes it (add override if missing from container env template)
if ! "${COMPOSE[@]}" exec -T control-api printenv GOVERNANCE_IPFS_STUB >/dev/null 2>&1; then
  echo "note: will appear after recreate"
fi

"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 40); do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-control-api-1 2>/dev/null || echo missing)
  echo "try=$i health=$st"
  [[ "$st" == "healthy" ]] && break
  sleep 3
done

"${COMPOSE[@]}" exec -T control-api printenv GOVERNANCE_IPFS_STUB PINATA_JWT 2>/dev/null | sed 's/\(PINATA_JWT=\).*/\1***/' || true

# Quick unit-style check of stub path via Go isn't available; smoke via python calling the same env
python3 - <<'PY'
import os, hashlib, binascii
# mimic stubCID
content = "governance smoke"
sum = hashlib.sha256(content.encode()).digest()
print("stub_cid_sample", "bafye2e" + binascii.hexlify(sum[:16]).decode())
PY

echo GOVERNANCE_IPFS_STUB_ENABLED
