#!/usr/bin/env bash
# Deploy BC-11 Phase-1 control-api (SubmitZKBatch wiring).
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

install /tmp/bc11/zk_batch.go services/control-api/internal/solana/zk_batch.go
install /tmp/bc11/zk_batch_test.go services/control-api/internal/solana/zk_batch_test.go
install /tmp/bc11/zk_aggregator.go services/control-api/internal/billing/zk_aggregator.go

grep -q 'ProofHash' services/control-api/internal/solana/zk_batch.go
grep -q 'SysVarInstructionsPubkey' services/control-api/internal/solana/zk_batch.go
grep -q 'ProofHashFromBytes' services/control-api/internal/billing/zk_aggregator.go
echo SOURCES_OK

"${COMPOSE[@]}" build --no-cache control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

for i in $(seq 1 40); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "try=$i api=$st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done

"${COMPOSE[@]}" exec -T control-api sh -c 'strings /server | grep -c ProofHashFromBytes'
curl -fsS -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health || true
"${COMPOSE[@]}" logs --tail=40 control-api 2>/dev/null | grep -E 'BC-08|Multi-Sig|ZK|Halo2|error' | tail -20 || true
echo BC11_DEPLOY_DONE
