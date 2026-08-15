#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== sample control-api logs (zerolog / component) ==="
"${COMPOSE[@]}" logs control-api --since 10m 2>/dev/null | grep -E 'component|WALLET|JOURNAL|discrepancy|DRIFT|MISMATCH|Alert|alert' | head -60 || echo NONE

echo "=== full log line count since 10m ==="
"${COMPOSE[@]}" logs control-api --since 10m 2>/dev/null | wc -l

echo "=== edge status ==="
"${COMPOSE[@]}" ps edge-gateway --format 'table {{.Name}}\t{{.Status}}'
curl -fsS -o /dev/null -w "edge_health=%{http_code}\n" http://127.0.0.1:8090/health

echo "=== live drift count ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c "
SELECT COUNT(*) FROM (
  SELECT w.id
  FROM wallets w
  LEFT JOIN (
    SELECT wallet_id, SUM(amount_lamports) AS liability_sum
    FROM ledger_journal_lines
    WHERE account_code = '2100' AND wallet_id IS NOT NULL
    GROUP BY wallet_id
  ) j ON j.wallet_id = w.id
  WHERE COALESCE(j.liability_sum, 0) + w.balance_lamports <> 0
) t;
"

echo OPS_ZEROLOG_SAMPLE_DONE
