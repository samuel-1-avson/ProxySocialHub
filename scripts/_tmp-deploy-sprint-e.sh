#!/usr/bin/env bash
# Sprint E deploy: apply compose/docs/scripts; recreate control-api; smoke custody.
set -euo pipefail
TAR="${1:?usage: $0 /tmp/sprint-e-custody.tar.gz}"
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DOCKER="${DOCKER:-docker}"
cd "$PROJECT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Extract $TAR"
tar -xzf "$TAR" -C "$PROJECT_DIR"
find "$PROJECT_DIR/scripts" "$PROJECT_DIR/docs" "$PROJECT_DIR" -maxdepth 3 \
  -type f \( -name '*.sh' -o -name '*.yml' -o -name '*.md' -o -name '*.example' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true
chmod +x "$PROJECT_DIR/scripts/"gcp-*.sh 2>/dev/null || true

COMPOSE=("$DOCKER" compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

# Ensure .env fail-closed flags (idempotent)
set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}
set_env USE_GCP_KMS true
set_env USE_AWS_KMS false
set_env PROXYHUB_REQUIRE_GCP_KMS true
# Key name / pubkey only if unset
if ! grep -q '^GCP_KMS_KEY_NAME=.\+' .env 2>/dev/null; then
  set_env GCP_KMS_KEY_NAME "projects/gen-lang-client-0022105784/locations/us-central1/keyRings/proxyhubb-oracle/cryptoKeys/oracle-ed25519/cryptoKeyVersions/1"
fi
if ! grep -q '^GCP_KMS_PUBLIC_KEY=.\+' .env 2>/dev/null; then
  set_env GCP_KMS_PUBLIC_KEY "8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2"
fi

echo "=== recreate control-api with new compose defaults ==="
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 40); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "$st" | grep -qi healthy && break
  sleep 3
done
echo "$st" | grep -qi healthy || { echo "FAIL: control-api not healthy"; exit 1; }

FLAG=$("${COMPOSE[@]}" exec -T control-api printenv USE_GCP_KMS | tr -d '\r')
REQ=$("${COMPOSE[@]}" exec -T control-api printenv PROXYHUB_REQUIRE_GCP_KMS | tr -d '\r')
[[ "$FLAG" == "true" ]] || { echo "FAIL USE_GCP_KMS=$FLAG"; exit 1; }
[[ "$REQ" == "true" ]] || { echo "FAIL PROXYHUB_REQUIRE_GCP_KMS=$REQ"; exit 1; }

echo "=== KMS log assert ==="
sleep 2
"$DOCKER" logs proxyhubb-control-api-1 2>&1 | grep -F 'Initialized GCP Cloud KMS signer' | tail -3
"$DOCKER" logs proxyhubb-control-api-1 2>&1 | grep -F 'BC-08 custody split active' | tail -2

echo "=== align script refuse ==="
if bash "$PROJECT_DIR/scripts/gcp-align-treasury-to-oracle.sh" 2>/tmp/align-refuse.txt; then
  echo "FAIL: align script should refuse"; cat /tmp/align-refuse.txt; exit 1
else
  grep -q REFUSED /tmp/align-refuse.txt && echo "ALIGN_REFUSED_OK" || { cat /tmp/align-refuse.txt; exit 1; }
fi

echo "=== cold not mounted ==="
MOUNTS=$("$DOCKER" inspect proxyhubb-control-api-1 --format '{{range .Mounts}}{{.Destination}};{{end}}')
echo "$MOUNTS" | grep -qi cold && { echo "FAIL cold mounted"; exit 1; } || echo "COLD_NOT_MOUNTED_OK"

echo "=== public config ==="
curl -fsS --max-time 10 http://127.0.0.1:8080/v1/system/config/public | tee /tmp/pub-cfg.json
python3 - <<'PY'
import json
d=json.load(open("/tmp/pub-cfg.json"))
assert d.get("destination_kind")=="vault", d
assert d.get("vault_address") and d["vault_address"]==d.get("deposit_address")
print("PUBLIC_VAULT_OK")
PY

echo "=== treasury liquidity smoke (best-effort) ==="
if [[ -x "$PROJECT_DIR/scripts/gcp-smoke-treasury-liquidity.sh" ]]; then
  DOCKER="$DOCKER" bash "$PROJECT_DIR/scripts/gcp-smoke-treasury-liquidity.sh" || echo "WARN: liquidity smoke soft-fail"
fi

curl -fsS --max-time 10 -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health
echo "SPRINT_E_VERIFY_OK"
