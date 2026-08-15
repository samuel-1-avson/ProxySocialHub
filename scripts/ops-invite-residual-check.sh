#!/usr/bin/env bash
# Re-measure TRIAGE-01 residual (wallet + journal + surplus).
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
psqlc() { "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 -c "$1"; }

echo "=== wallets (seller + fe793802) ==="
psqlc "SELECT id::text, user_id::text, balance_lamports, round(balance_lamports/1e9::numeric, 9) AS sol
FROM wallets
WHERE id::text LIKE 'fe793802%' OR user_id = 'b77e84c9-0e85-4f23-afc0-581cd561c216'
ORDER BY balance_lamports DESC LIMIT 10;"

echo "=== journal 2100 drift for fe793802 ==="
psqlc "SELECT w.id::text AS wallet_id,
  w.balance_lamports,
  COALESCE(j.liability_sum, 0) AS journal_2100_sum,
  COALESCE(j.liability_sum, 0) + w.balance_lamports AS drift_lamports,
  round((COALESCE(j.liability_sum, 0) + w.balance_lamports)/1e9::numeric, 9) AS drift_sol
FROM wallets w
LEFT JOIN (
  SELECT wallet_id, SUM(amount_lamports) AS liability_sum
  FROM ledger_journal_lines
  WHERE account_code = '2100' AND wallet_id IS NOT NULL
  GROUP BY wallet_id
) j ON j.wallet_id = w.id
WHERE w.id::text LIKE 'fe793802%';"

echo "=== top journal drifts ==="
psqlc "SELECT w.id::text AS wallet_id,
  COALESCE(j.liability_sum, 0) + w.balance_lamports AS drift_lamports,
  round((COALESCE(j.liability_sum, 0) + w.balance_lamports)/1e9::numeric, 6) AS drift_sol
FROM wallets w
LEFT JOIN (
  SELECT wallet_id, SUM(amount_lamports) AS liability_sum
  FROM ledger_journal_lines
  WHERE account_code = '2100' AND wallet_id IS NOT NULL
  GROUP BY wallet_id
) j ON j.wallet_id = w.id
WHERE COALESCE(j.liability_sum, 0) + w.balance_lamports <> 0
ORDER BY ABS(COALESCE(j.liability_sum, 0) + w.balance_lamports) DESC
LIMIT 10;"

echo "=== ops_alerts money recent ==="
psqlc "SELECT created_at, severity, title FROM ops_alerts
WHERE title ILIKE '%journal%' OR title ILIKE '%treasury%' OR title ILIKE '%reconcil%' OR title ILIKE '%deficit%'
ORDER BY created_at DESC LIMIT 15;" 2>/dev/null || echo "ops_alerts_missing"

echo "=== public config network ==="
curl -sS -m 10 https://api.proxyhubb.com/v1/system/config/public | head -c 800; echo
