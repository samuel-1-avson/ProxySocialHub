#!/usr/bin/env bash
# Enable Groth16 settlement lane on proxyhubb-testnet.
# Run as root on the VM (sudo bash).
set -euo pipefail
cd /opt/proxyhubb

COMPOSE=(docker compose
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
)
if [[ -f docker-compose.gcp-images.yml ]]; then
  COMPOSE+=(-f docker-compose.gcp-images.yml)
fi

EXPECTED_VK=2f1075c22786a7763bfaee9ec39188b2aec7fb19de0aa1c3aac9e7ce29519e72

echo "== stage 0: ensure .env keys =="
touch .env
ensure_kv() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    printf '\n%s=%s\n' "$key" "$val" >> .env
  fi
}
# Prover URL first; require lane stays false until healthz OK.
ensure_kv GROTH16_PROVER_URL "http://groth16-prover:8096"
ensure_kv GROTH16_PROVER_TIMEOUT_MS "30000"
ensure_kv GROTH16_PROVER_REQUIRED "false"
ensure_kv PROXYHUB_ZK_ONCHAIN_GROTH16_READY "true"
ensure_kv PROXYHUB_ZK_ONCHAIN_GROTH16 "false"
grep -E '^(PROXYHUB_ZK_ONCHAIN_GROTH16|GROTH16_PROVER)' .env

echo "== stage 1: build+start groth16-prover =="
"${COMPOSE[@]}" --profile groth16 up -d --build --no-deps groth16-prover

echo "== stage 1b: rebuild control-api from local sources (has groth16 client) =="
# Prefer local build over GHCR pin for this lane cutover.
BUILD_COMPOSE=(docker compose
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
)
"${BUILD_COMPOSE[@]}" build control-api
"${BUILD_COMPOSE[@]}" up -d --no-deps --force-recreate control-api

echo "== stage 2: wait healthz =="
ok=0
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8096/healthz >/tmp/g16_health.json 2>/dev/null; then
    vk=$(python3 -c 'import json; print(json.load(open("/tmp/g16_health.json")).get("vk_hash_hex",""))')
    echo "health attempt $i vk=$vk"
    if [[ "$vk" == "$EXPECTED_VK" ]]; then
      ok=1
      break
    fi
    echo "VK mismatch — abort"
    exit 2
  fi
  sleep 3
done
if [[ "$ok" != "1" ]]; then
  echo "groth16-prover healthz failed"
  "${COMPOSE[@]}" --profile groth16 logs --tail=80 groth16-prover || true
  exit 3
fi
echo "HEALTHZ_OK vk=$EXPECTED_VK"

echo "== stage 3: enable require lane + recreate control-api =="
ensure_kv PROXYHUB_ZK_ONCHAIN_GROTH16 "true"
grep -E '^(PROXYHUB_ZK_ONCHAIN_GROTH16|GROTH16_PROVER)' .env
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

echo "== stage 4: confirm system config =="
sleep 15
cfg_ok=0
for port in 18080 8080; do
  if curl -fsS "http://127.0.0.1:${port}/v1/system/config" >/tmp/syscfg.json 2>/dev/null; then
    python3 - <<'PY'
import json
d=json.load(open("/tmp/syscfg.json"))
print("zk_onchain_groth16=", d.get("zk_onchain_groth16"))
print("zk_onchain_groth16_ready=", d.get("zk_onchain_groth16_ready"))
assert d.get("zk_onchain_groth16") in (True, "true", 1)
assert d.get("zk_onchain_groth16_ready") in (True, "true", 1)
print("CONFIG_OK")
PY
    cfg_ok=1
    break
  fi
done
if [[ "$cfg_ok" != "1" ]]; then
  echo "system/config assert failed"
  "${COMPOSE[@]}" exec -T control-api printenv | grep -E 'PROXYHUB_ZK|GROTH16' || true
  exit 4
fi

echo "== stage 5: prove smoke via prover =="
curl -fsS -X POST http://127.0.0.1:8096/v1/prove/batch-groth16 \
  -H 'Content-Type: application/json' \
  -d '{"batch_root":"1111111111111111111111111111111111111111111111111111111111111111","session_count":3,"total_bytes":1000,"period_start":1,"period_end":2}' \
  >/tmp/g16_prove.json
python3 - <<'PY'
import json, base64
d=json.load(open("/tmp/g16_prove.json"))
proof=base64.b64decode(d["proof_base64"])
assert len(proof)==256, len(proof)
assert d["vk_hash_hex"]=="2f1075c22786a7763bfaee9ec39188b2aec7fb19de0aa1c3aac9e7ce29519e72"
print("PROVE_OK proof_len=256")
PY

echo "GROTH16_LANE_ENABLED"
