#!/usr/bin/env bash
# Deploy BC-05 control-api client + fail-closed settle gate to proxyhubb-testnet.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

install() {
  local src="$1" dst="$2"
  [[ -f "$src" ]] || { echo "missing $src"; exit 1; }
  mkdir -p "$(dirname "$dst")"
  tr -d '\015' <"$src" >"$dst"
  echo "installed $dst"
}

install /tmp/settlement.go services/control-api/internal/solana/settlement.go
install /tmp/attestation.go services/control-api/internal/solana/attestation.go
install /tmp/usage.go services/control-api/internal/api/usage.go
install /tmp/mode.go services/control-api/internal/decentralization/mode.go
install /tmp/mode_usage_proof_test.go services/control-api/internal/decentralization/mode_usage_proof_test.go
install /tmp/docker-compose.gcp-testnet.yml docker-compose.gcp-testnet.yml

# Ensure base compose has the env key
if ! grep -q PROXYHUB_REQUIRE_USAGE_PROOF_BEFORE_SETTLE docker-compose.yml; then
  python3 - <<'PY'
from pathlib import Path
p = Path("docker-compose.yml")
t = p.read_text()
needle = "      - PROXYHUB_REQUIRE_SESSION_PDA=${PROXYHUB_REQUIRE_SESSION_PDA:-false}\n"
ins = needle + "      - PROXYHUB_REQUIRE_USAGE_PROOF_BEFORE_SETTLE=${PROXYHUB_REQUIRE_USAGE_PROOF_BEFORE_SETTLE:-false}\n"
if needle in t:
    p.write_text(t.replace(needle, ins, 1))
    print("docker-compose.yml patched")
PY
fi

# Persist flag in .env
if grep -qE '^PROXYHUB_REQUIRE_USAGE_PROOF_BEFORE_SETTLE=' .env 2>/dev/null; then
  sed -i 's/^PROXYHUB_REQUIRE_USAGE_PROOF_BEFORE_SETTLE=.*/PROXYHUB_REQUIRE_USAGE_PROOF_BEFORE_SETTLE=true/' .env
else
  echo 'PROXYHUB_REQUIRE_USAGE_PROOF_BEFORE_SETTLE=true' >> .env
fi

grep -q 'program_state PDA' services/control-api/internal/solana/settlement.go
grep -q 'RequireUsageProofBeforeSettle' services/control-api/internal/api/usage.go
grep -q 'PROXYHUB_REQUIRE_USAGE_PROOF_BEFORE_SETTLE' docker-compose.gcp-testnet.yml
echo SOURCES_OK

"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

for i in $(seq 1 48); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "try=$i api=$st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done
echo "$st" | grep -qi healthy

FLAG=$("${COMPOSE[@]}" exec -T control-api printenv PROXYHUB_REQUIRE_USAGE_PROOF_BEFORE_SETTLE | tr -d '\r')
echo "flag=$FLAG"
[[ "$FLAG" == "true" ]]

# Smoke: program_state PDA derivation is in binary; webhook/health still ok
curl -fsS -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/v1/system/config/public | head -c 300; echo

# Confirm strings in running binary
CID=$("${COMPOSE[@]}" ps -q control-api)
docker exec "$CID" sh -c 'strings /server | grep -E "REQUIRE_USAGE_PROOF_BEFORE_SETTLE|SubmitUsageProof: program_state" | head'
echo BC05_CONTROL_API_DEPLOY_DONE
