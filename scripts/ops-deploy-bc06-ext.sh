#!/usr/bin/env bash
# Patch control-api BC-06 extension (auto-release + usage SettleOrderEscrow) and rebuild web from sources.
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

install /tmp/bc06ext/escrow.go services/control-api/internal/api/escrow.go
install /tmp/bc06ext/escrow_settle.go services/control-api/internal/api/escrow_settle.go
install /tmp/bc06ext/usage.go services/control-api/internal/api/usage.go
install /tmp/bc06ext/compensation_outbox.go services/control-api/internal/api/compensation_outbox.go

# Web sources (may already be present from BC-06)
mkdir -p apps/web/src/lib/idl apps/web/src/components apps/web/src/lib/api
install /tmp/bc06ext/solana.ts apps/web/src/lib/solana.ts
install /tmp/bc06ext/BuyListingModal.tsx apps/web/src/components/BuyListingModal.tsx
install /tmp/bc06ext/marketplace.ts apps/web/src/lib/api/marketplace.ts
install /tmp/bc06ext/proxyhub.json apps/web/src/lib/idl/proxyhub.json

grep -q 'SettleOrderEscrowUsage' services/control-api/internal/api/escrow_settle.go
grep -q 'SettleOrderEscrow(ctx, "api.escrow.auto_release"' services/control-api/internal/api/escrow.go
grep -q 'SettleOrderEscrowUsage(ctx, "api.usage.anchor_and_settle"' services/control-api/internal/api/usage.go
grep -q 'initializeEscrowMultisig' apps/web/src/lib/solana.ts
grep -q "escrow_seed_kind === 'multisig'" apps/web/src/components/BuyListingModal.tsx
echo SOURCES_OK

"${COMPOSE[@]}" build --no-cache control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

# Build web from on-VM sources (testnet compose allows local build)
"${COMPOSE[@]}" build --no-cache web
"${COMPOSE[@]}" up -d --no-deps --force-recreate web

for i in $(seq 1 60); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  wst=$("${COMPOSE[@]}" ps web --format '{{.Status}}' || true)
  echo "try=$i api=$st web=$wst"
  echo "$st" | grep -qi healthy && echo "$wst" | grep -qiE 'healthy|up' && break
  sleep 5
done

"${COMPOSE[@]}" exec -T control-api sh -c 'strings /server | grep -c SettleOrderEscrowUsage'
curl -fsS -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health || true
curl -fsS -o /dev/null -w "web=%{http_code}\n" http://127.0.0.1:3000/ || true
echo BC06EXT_DEPLOY_DONE
