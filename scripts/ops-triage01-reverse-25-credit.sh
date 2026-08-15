#!/usr/bin/env bash
# TRIAGE-01: reverse mistaken +25 SOL deposit credit on fe793802 while KEEP on-chain vault SOL.
# Does NOT send any on-chain transaction.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
OUT_DIR=docs/ops/evidence
mkdir -p "$OUT_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
REPORT="$OUT_DIR/TRIAGE01_reverse_25_credit_${STAMP}.md"
WALLET=fe793802-7249-423c-a502-780b6a5d48f8
USER_ID=b77e84c9-0e85-4f23-afc0-581cd561c216
LAMPORTS=25000000000
REF="triage01-reserve-reclass-${STAMP}"
TXHASH=2iFdcMXRYj4N9uENKu3agJF1piHAZWToCdG74hJRRnG5ZDHqNMZEjZEceMHk1hQrGZicG2CN5Fg71JUnUEeXGpQW

psql() { "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 "$@"; }

{
  echo "# TRIAGE-01 reverse +25 deposit credit — $STAMP"
  echo
  echo "| Field | Value |"
  echo "|-------|-------|"
  echo "| Wallet | \`$WALLET\` |"
  echo "| Lamports reversed | \`$LAMPORTS\` (25 SOL) |"
  echo "| On-chain vault | unchanged (keep reserve) |"
  echo "| Source tx | \`$TXHASH\` |"
  echo
  echo "## Before"
  echo '```'
  psql -c "SELECT id::text, balance_lamports, ROUND(balance_lamports/1000000000.0,9) AS sol FROM wallets WHERE id='$WALLET';"
  psql -c "SELECT COALESCE(SUM(balance_lamports),0) AS liab_lamports, ROUND(COALESCE(SUM(balance_lamports),0)/1000000000.0,9) AS liab_sol FROM wallets;"
  echo '```'
} >"$REPORT"

# Idempotency: skip if already applied
EXIST=$(psql -At -c "SELECT COUNT(*) FROM wallet_ledger_entries WHERE reference_id='$REF' OR (wallet_id='$WALLET' AND type='treasury_reserve_reclass' AND amount_lamports=-$LAMPORTS AND description LIKE 'TRIAGE-01%');" | tr -d '\r')
if [[ "${EXIST:-0}" != "0" ]]; then
  echo "Already applied (exist=$EXIST)" | tee -a "$REPORT"
  echo TRIAGE01_REVERSE_ALREADY
  exit 0
fi

echo "=== applying reverse ===" | tee -a "$REPORT"
psql <<SQL | tee -a "$REPORT"
BEGIN;

-- Lock wallet
SELECT id, balance_lamports FROM wallets WHERE id = '$WALLET' FOR UPDATE;

-- Safety: must still have at least 25 SOL credited
DO \$\$
DECLARE bal BIGINT;
BEGIN
  SELECT balance_lamports INTO bal FROM wallets WHERE id = '$WALLET';
  IF bal IS NULL OR bal < $LAMPORTS THEN
    RAISE EXCEPTION 'wallet balance % too low to reverse %', bal, $LAMPORTS;
  END IF;
END \$\$;

-- 1) Append ledger debit (append-only INSERT)
INSERT INTO wallet_ledger_entries (
  id, wallet_id, amount, balance_after, amount_lamports, balance_after_lamports,
  type, reference_id, tx_hash, description, created_at
)
SELECT
  gen_random_uuid(),
  '$WALLET'::uuid,
  -25.0,
  (balance_lamports - $LAMPORTS) / 1000000000.0,
  -$LAMPORTS,
  balance_lamports - $LAMPORTS,
  'treasury_reserve_reclass',
  '$REF',
  NULL,
  'TRIAGE-01: reverse mistaken vault deposit credit; SOL remains vault treasury reserve (source_tx=$TXHASH)',
  NOW()
FROM wallets WHERE id = '$WALLET';

-- 2) Update wallet balances
UPDATE wallets
SET balance_lamports = balance_lamports - $LAMPORTS,
    balance_sol = (balance_lamports - $LAMPORTS) / 1000000000.0,
    updated_at = NOW()
WHERE id = '$WALLET';

-- 3) Balanced journal: reduce user liability, book platform reserve (4000)
--    (keeps 1001 vault-cash journal from original deposit aligned with on-chain vault)
WITH j AS (
  INSERT INTO ledger_journals (id, external_ref, entry_type, description, created_at)
  VALUES (
    gen_random_uuid(),
    '$REF',
    'treasury_reserve_reclass',
    'TRIAGE-01 reverse deposit credit → vault reserve',
    NOW()
  )
  RETURNING id
)
INSERT INTO ledger_journal_lines (id, journal_id, account_code, wallet_id, amount_lamports, created_at)
SELECT gen_random_uuid(), j.id, '2100', '$WALLET'::uuid, $LAMPORTS, NOW() FROM j
UNION ALL
SELECT gen_random_uuid(), j.id, '4000', NULL, -$LAMPORTS, NOW() FROM j;

COMMIT;

SELECT 'wallet_after' AS k, balance_lamports, ROUND(balance_lamports/1000000000.0,9) AS sol
FROM wallets WHERE id='$WALLET';
SELECT 'liab_after' AS k, COALESCE(SUM(balance_lamports),0) AS lamports,
       ROUND(COALESCE(SUM(balance_lamports),0)/1000000000.0,9) AS sol
FROM wallets;
SELECT 'ledger_row' AS k, created_at, amount_lamports, type, reference_id
FROM wallet_ledger_entries WHERE reference_id='$REF';
SELECT 'journal' AS k, id::text, entry_type, external_ref FROM ledger_journals WHERE external_ref='$REF';
SELECT 'journal_lines' AS k, account_code, wallet_id::text, amount_lamports
FROM ledger_journal_lines WHERE journal_id = (SELECT id FROM ledger_journals WHERE external_ref='$REF');
SQL

# Clear anomaly freeze if present (withdrawals were 403 flagged)
echo "=== security flag check ===" | tee -a "$REPORT"
psql -c "SELECT column_name FROM information_schema.columns WHERE table_name='profiles' AND column_name ILIKE '%flag%' OR (table_name='users' AND column_name ILIKE '%flag%') OR (table_name='wallets' AND column_name ILIKE '%flag%') ORDER BY 1;" 2>/dev/null | tee -a "$REPORT" || true
psql -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%anomal%' OR table_name ILIKE '%flag%' OR table_name ILIKE '%freeze%') ORDER BY 1;" 2>/dev/null | tee -a "$REPORT" || true

{
  echo
  echo "## Expected recon after"
  echo "- Vault on-chain: 31.01 SOL (unchanged)"
  echo "- Hot: 7.22 SOL"
  echo "- Combined: ~38.23 SOL"
  echo "- Liabilities: prior 40.42 - 25 = ~15.42 SOL"
  echo "- Status: SURPLUS ~22.8 SOL"
  echo
  echo "## Verdict"
  echo "**APPLIED** — internal credit reversed; vault reserve retained."
} >>"$REPORT"

echo "TRIAGE_REPORT=$REPORT"
echo TRIAGE01_REVERSE_DONE
