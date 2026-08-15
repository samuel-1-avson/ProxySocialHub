#!/usr/bin/env bash
# Wave-1 money triage: treasury vs liabilities + journal/ledger drift dumps.
# Read-only. Does NOT mutate balances.
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
cd "$PROJECT_DIR"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
OUT_DIR="$PROJECT_DIR/docs/ops/evidence"
mkdir -p "$OUT_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
REPORT="$OUT_DIR/TRIAGE01_money_${STAMP}.md"
TARGET_WALLET="${TARGET_WALLET:-fe793802}"

psql() {
  "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 "$@"
}

{
  echo "# TRIAGE-01 Money triage — $STAMP"
  echo
  echo "| Field | Value |"
  echo "|-------|-------|"
  echo "| Host | \`(hostname)\` |"
  echo "| Mode | read-only SQL + env address dump |"
  echo "| Target wallet prefix | \`$TARGET_WALLET\` |"
  echo

  echo "## Env treasury / custody addresses (redacted style = full pubkeys OK)"
  echo '```'
  grep -E '^(TREASURY_|ORACLE_|HOT_|COLD_|VAULT_|CUSTODY_|SOLANA_TREASURY)' .env 2>/dev/null \
    | sed 's/\r$//' || echo "(none matched)"
  echo '```'
  echo

  echo "## Wallet totals"
  echo '```'
  psql -c "SELECT COUNT(*) AS wallets, COALESCE(SUM(balance_lamports),0) AS sum_lamports, ROUND(COALESCE(SUM(balance_lamports),0)/1000000000.0, 9) AS sum_sol FROM wallets;"
  echo '```'
  echo

  echo "## Top wallets by balance"
  echo '```'
  psql -c "SELECT id::text, user_id::text, balance_lamports, ROUND(balance_lamports/1000000000.0, 9) AS sol, updated_at FROM wallets ORDER BY balance_lamports DESC LIMIT 15;"
  echo '```'
  echo

  echo "## Target wallet fe793802* detail"
  echo '```'
  psql -c "
SELECT w.id::text, w.user_id::text, w.balance_lamports,
       ROUND(w.balance_lamports/1000000000.0,9) AS sol,
       COALESCE(h.s,0) AS ledger_hot,
       COALESCE(a.s,0) AS ledger_archive,
       COALESCE(h.s,0)+COALESCE(a.s,0) AS ledger_total,
       w.balance_lamports - (COALESCE(h.s,0)+COALESCE(a.s,0)) AS db_minus_ledger
FROM wallets w
LEFT JOIN (SELECT wallet_id, SUM(amount_lamports) s FROM wallet_ledger_entries GROUP BY wallet_id) h ON h.wallet_id=w.id
LEFT JOIN (SELECT wallet_id, SUM(amount_lamports) s FROM wallet_ledger_entries_archive GROUP BY wallet_id) a ON a.wallet_id=w.id
WHERE w.id::text ILIKE '${TARGET_WALLET}%';
"
  echo '```'
  echo

  echo "## Ledger entry counts for target"
  echo '```'
  psql -c "
SELECT 'hot' AS src, COUNT(*), COALESCE(SUM(amount_lamports),0) AS sum
FROM wallet_ledger_entries WHERE wallet_id::text ILIKE '${TARGET_WALLET}%'
UNION ALL
SELECT 'archive', COUNT(*), COALESCE(SUM(amount_lamports),0)
FROM wallet_ledger_entries_archive WHERE wallet_id::text ILIKE '${TARGET_WALLET}%';
"
  echo '```'
  echo

  echo "## Recent ledger lines (target, last 30)"
  echo '```'
  psql -c "
SELECT created_at, entry_type, amount_lamports, ROUND(amount_lamports/1000000000.0,9) AS sol, reference, notes
FROM (
  SELECT created_at, entry_type::text, amount_lamports, COALESCE(reference,'') AS reference, COALESCE(notes,'') AS notes
  FROM wallet_ledger_entries WHERE wallet_id::text ILIKE '${TARGET_WALLET}%'
  UNION ALL
  SELECT created_at, entry_type::text, amount_lamports, COALESCE(reference,''), COALESCE(notes,'')
  FROM wallet_ledger_entries_archive WHERE wallet_id::text ILIKE '${TARGET_WALLET}%'
) x
ORDER BY created_at DESC LIMIT 30;
" 2>/dev/null || psql -c "
SELECT created_at, amount_lamports, ROUND(amount_lamports/1000000000.0,9) AS sol
FROM wallet_ledger_entries WHERE wallet_id::text ILIKE '${TARGET_WALLET}%'
ORDER BY created_at DESC LIMIT 30;
"
  echo '```'
  echo

  echo "## Journal tables present?"
  echo '```'
  psql -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'ledger_journal%' ORDER BY 1;"
  echo '```'
  echo

  if psql -At -c "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='ledger_journal_lines');" | grep -q t; then
    echo "## Journal liability vs wallets (global)"
    echo '```'
    psql -c "
SELECT
  COALESCE((SELECT SUM(amount_lamports) FROM ledger_journal_lines WHERE account_code='2100'),0) AS liability_sum,
  COALESCE((SELECT SUM(balance_lamports) FROM wallets),0) AS wallet_sum,
  COALESCE((SELECT SUM(amount_lamports) FROM ledger_journal_lines WHERE account_code='2100'),0)
    + COALESCE((SELECT SUM(balance_lamports) FROM wallets),0) AS expected_zero;
"
    echo '```'
    echo

    echo "## Per-wallet journal drift (top 20)"
    echo '```'
    psql -c "
SELECT w.id::text AS wallet_id,
  COALESCE(j.liability_sum,0) AS liability_sum,
  w.balance_lamports,
  COALESCE(j.liability_sum,0)+w.balance_lamports AS drift
FROM wallets w
LEFT JOIN (
  SELECT wallet_id, SUM(amount_lamports) AS liability_sum
  FROM ledger_journal_lines
  WHERE account_code='2100' AND wallet_id IS NOT NULL
  GROUP BY wallet_id
) j ON j.wallet_id=w.id
WHERE COALESCE(j.liability_sum,0)+w.balance_lamports <> 0
ORDER BY ABS(COALESCE(j.liability_sum,0)+w.balance_lamports) DESC
LIMIT 20;
"
    echo '```'
    echo

    echo "## Target wallet journal 2100 lines"
    echo '```'
    psql -c "
SELECT created_at, journal_id::text, amount_lamports, ROUND(amount_lamports/1000000000.0,9) AS sol, memo
FROM ledger_journal_lines
WHERE account_code='2100' AND wallet_id::text ILIKE '${TARGET_WALLET}%'
ORDER BY created_at DESC LIMIT 40;
" 2>/dev/null || psql -c "
SELECT journal_id::text, amount_lamports, ROUND(amount_lamports/1000000000.0,9) AS sol
FROM ledger_journal_lines
WHERE account_code='2100' AND wallet_id::text ILIKE '${TARGET_WALLET}%'
LIMIT 40;
"
    echo '```'
    echo
  fi

  echo "## Pending withdrawals / outbox (if tables exist)"
  echo '```'
  psql -c "
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND (
  table_name ILIKE '%withdraw%' OR table_name ILIKE '%outbox%' OR table_name ILIKE '%pending%'
) ORDER BY 1;
"
  echo '```'
  echo

  echo "## Recent control-api deficit/drift logs (12h sample)"
  echo '```'
  "${COMPOSE[@]}" logs --since=12h control-api 2>/dev/null \
    | grep -Ei 'treasury deficit|JOURNAL vs WALLET|WALLET RECONCILIATION|DEFICIT|surplus' \
    | tail -40 || echo "(none)"
  echo '```'
  echo

  echo "## Operator notes"
  echo "- This report is diagnostic only — no balance mutation."
  echo "- Next: classify deficit cause (wrong treasury pubkey vs vault-only assets, sandboxed test credits, missing deposit credits)."
  echo "- For journal drift on fe793802: decide backfill 2100 lines vs reset dual-write sandbox banner."
} >"$REPORT"

echo "TRIAGE_REPORT=$REPORT"
echo TRIAGE01_DONE
