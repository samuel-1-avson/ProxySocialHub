#!/usr/bin/env bash
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

install /tmp/escrow.go services/control-api/internal/api/escrow.go
install /tmp/dispute_jury.go services/control-api/internal/api/dispute_jury.go
install /tmp/disputes.go services/control-api/internal/api/disputes.go
install /tmp/main.go services/control-api/main.go
install /tmp/mode.go services/control-api/internal/decentralization/mode.go
install /tmp/docker-compose.gcp-testnet.yml docker-compose.gcp-testnet.yml

if ! grep -q PROXYHUB_ESCROW_CHALLENGE_DAYS docker-compose.yml; then
  python3 - <<'PY'
from pathlib import Path
p = Path("docker-compose.yml")
t = p.read_text()
needle = "      - PROXYHUB_REQUIRE_USAGE_PROOF_BEFORE_SETTLE=${PROXYHUB_REQUIRE_USAGE_PROOF_BEFORE_SETTLE:-false}\n"
ins = needle + "      - PROXYHUB_ESCROW_CHALLENGE_DAYS=${PROXYHUB_ESCROW_CHALLENGE_DAYS:-7}\n"
if needle in t and "PROXYHUB_ESCROW_CHALLENGE_DAYS" not in t:
    p.write_text(t.replace(needle, ins, 1))
    print("docker-compose.yml patched")
PY
fi

if grep -qE '^PROXYHUB_ESCROW_CHALLENGE_DAYS=' .env 2>/dev/null; then
  sed -i 's/^PROXYHUB_ESCROW_CHALLENGE_DAYS=.*/PROXYHUB_ESCROW_CHALLENGE_DAYS=7/' .env
else
  echo 'PROXYHUB_ESCROW_CHALLENGE_DAYS=7' >> .env
fi

grep -q 'StartEscrowAutoReleaseWorker' services/control-api/main.go
grep -q 'autoReleaseBlockReason' services/control-api/internal/api/escrow.go
grep -q 'EscrowChallengeDays' services/control-api/internal/api/escrow.go
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

DAYS=$("${COMPOSE[@]}" exec -T control-api printenv PROXYHUB_ESCROW_CHALLENGE_DAYS | tr -d '\r')
echo "challenge_days=$DAYS"
[[ "$DAYS" == "7" ]]

sleep 3
"${COMPOSE[@]}" logs control-api --since 2m 2>/dev/null \
  | grep -E 'AutoRelease worker started|Dispute expiry worker|challenge window' | tail -10 || true

curl -fsS -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:8080/health
echo CHALLENGE_WINDOW_DEPLOY_DONE
