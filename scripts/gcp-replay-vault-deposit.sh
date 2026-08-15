#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
# Strip CRs without eating trailing 'r' (bash "\r" in double quotes is just 'r')
tr -d '\015' < /tmp/watcher.go > /opt/proxyhubb/services/control-api/internal/solana/watcher.go
# sanity: identifiers must end with r
grep -n 'EventHandler\|func (w \*Watcher)' /opt/proxyhubb/services/control-api/internal/solana/watcher.go | head -5

COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
SIG=49Vgc9uMqhecm4ZyMB3Tcy2HGnTDPJwVKCXkWUHREbbJpJCSownuVZSieRqMTEm9Ch7ByCsdWbEssn1kwVYDdwav
USER_ID=b77e84c9-0e85-4f23-afc0-581cd561c216

"${COMPOSE[@]}" build control-api
if grep -q '^PROXYHUB_WATCHER_START_SLOT=' .env; then
  sudo sed -i 's|^PROXYHUB_WATCHER_START_SLOT=.*|PROXYHUB_WATCHER_START_SLOT=0|' .env
else
  echo 'PROXYHUB_WATCHER_START_SLOT=0' | sudo tee -a .env >/dev/null
fi
"${COMPOSE[@]}" up -d --force-recreate --no-deps control-api
sleep 20
sudo docker logs proxyhubb-control-api-1 --since 1m 2>&1 | grep -iE 'Watcher|START_SLOT|GetTransaction failed|native_deposit|49Vgc|Auto-Deposit' | head -40 || true

for i in $(seq 1 24); do
  ROW=$("${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c \
    "SELECT status||'|'||destination_kind||'|'||amount::text FROM pending_transactions WHERE reference='$SIG' LIMIT 1;" || true)
  if [[ -n "$ROW" ]]; then echo "FOUND $ROW"; break; fi
  echo "wait $i"; sleep 5
done

"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT status, destination_kind, amount, LEFT(reference,24) FROM pending_transactions WHERE destination_kind='vault' ORDER BY created_at DESC LIMIT 5;"
BAL=$("${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c \
  "SELECT COALESCE(balance_sol,0) FROM wallets WHERE user_id='$USER_ID';")
echo "wallet_bal=$BAL"
sudo sed -i '/^PROXYHUB_WATCHER_START_SLOT=/d' .env
"${COMPOSE[@]}" up -d --force-recreate --no-deps control-api
sleep 8
curl -fsS http://127.0.0.1:8080/v1/system/config/public; echo
if [[ -n "${ROW:-}" ]]; then echo SMOKE_02_OK; else echo SMOKE_02_MISS; exit 2; fi
