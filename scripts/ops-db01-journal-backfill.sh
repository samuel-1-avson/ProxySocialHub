#!/usr/bin/env bash
# DB-01 slice 1a: catch up ledger_journal_lines (2100) to wallet SoT.
# Does NOT mutate wallets or wallet_ledger_entries.
#
# Default: dry-run (print drifted wallets + planned journals).
# Apply:   ./scripts/ops-db01-journal-backfill.sh --apply
#
# Run on proxyhubb-testnet from /opt/proxyhubb.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
cd "$PROJECT_DIR"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
if [[ -f docker-compose.redis-ha.yml ]]; then
  COMPOSE+=(-f docker-compose.redis-ha.yml)
fi

APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    -h|--help)
      echo "Usage: $0 [--apply]"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT_DIR="$PROJECT_DIR/docs/ops/evidence"
mkdir -p "$OUT_DIR"
REPORT="$OUT_DIR/DB01_dual_write_harden_${STAMP}.md"

psql() {
  "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 "$@"
}

psql_quiet() {
  "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 -At -F $'\t' "$@"
}

echo "# DB-01 dual-write harden — journal 2100 backfill — $STAMP"
echo
echo "| Field | Value |"
echo "|-------|-------|"
echo "| Host | \`$(hostname)\` |"
echo "| Mode | $([[ $APPLY -eq 1 ]] && echo APPLY || echo dry-run) |"
echo "| Wallet mutation | none (journal append only) |"
echo

echo "## Before: global 2100 vs wallets"
echo '```'
psql -c "
SELECT
  COALESCE((SELECT SUM(amount_lamports) FROM ledger_journal_lines WHERE account_code = '2100'), 0) AS liability_sum,
  COALESCE((SELECT SUM(balance_lamports) FROM wallets), 0) AS wallet_sum,
  COALESCE((SELECT SUM(amount_lamports) FROM ledger_journal_lines WHERE account_code = '2100'), 0)
    + COALESCE((SELECT SUM(balance_lamports) FROM wallets), 0) AS diff;
"
echo '```'
echo

echo "## Before: per-wallet drift (top 50)"
echo '```'
psql -c "
SELECT w.id::text AS wallet_id,
       COALESCE(j.liability_sum, 0) AS liability_sum,
       w.balance_lamports,
       COALESCE(j.liability_sum, 0) + w.balance_lamports AS diff,
       ROUND((COALESCE(j.liability_sum, 0) + w.balance_lamports)/1e9::numeric, 9) AS diff_sol
FROM wallets w
LEFT JOIN (
  SELECT wallet_id, SUM(amount_lamports) AS liability_sum
  FROM ledger_journal_lines
  WHERE account_code = '2100' AND wallet_id IS NOT NULL
  GROUP BY wallet_id
) j ON j.wallet_id = w.id
WHERE COALESCE(j.liability_sum, 0) + w.balance_lamports <> 0
ORDER BY ABS(COALESCE(j.liability_sum, 0) + w.balance_lamports) DESC
LIMIT 50;
"
echo '```'
echo

DRIFT_COUNT=$(psql_quiet -c "
SELECT COUNT(*)
FROM wallets w
LEFT JOIN (
  SELECT wallet_id, SUM(amount_lamports) AS liability_sum
  FROM ledger_journal_lines
  WHERE account_code = '2100' AND wallet_id IS NOT NULL
  GROUP BY wallet_id
) j ON j.wallet_id = w.id
WHERE COALESCE(j.liability_sum, 0) + w.balance_lamports <> 0;
" | tr -d '[:space:]')

echo "Drifted wallets: **${DRIFT_COUNT}**"
echo

if [[ "${DRIFT_COUNT}" == "0" ]]; then
  echo "## Result"
  echo
  echo "\`DB01_DUAL_WRITE_HARDEN_PASS\` — already clean (no backfill needed)."
  {
    echo "# DB-01 dual-write harden — $STAMP"
    echo
    echo "**Result:** \`DB01_DUAL_WRITE_HARDEN_PASS\` (already clean)"
    echo
    echo "No per-wallet 2100 drift; no journals written."
  } >"$REPORT"
  echo "Wrote $REPORT"
  exit 0
fi

# Capture drifts as wallet_id<TAB>diff
mapfile -t DRIFTS < <(psql_quiet -c "
SELECT w.id::text,
       COALESCE(j.liability_sum, 0) + w.balance_lamports AS diff
FROM wallets w
LEFT JOIN (
  SELECT wallet_id, SUM(amount_lamports) AS liability_sum
  FROM ledger_journal_lines
  WHERE account_code = '2100' AND wallet_id IS NOT NULL
  GROUP BY wallet_id
) j ON j.wallet_id = w.id
WHERE COALESCE(j.liability_sum, 0) + w.balance_lamports <> 0
ORDER BY ABS(COALESCE(j.liability_sum, 0) + w.balance_lamports) DESC;
")

echo "## Planned adjusting journals"
echo
echo "| wallet_id | diff_lamports | action |"
echo "|-----------|--------------:|--------|"
for row in "${DRIFTS[@]}"; do
  wid="${row%%$'\t'*}"
  diff="${row#*$'\t'}"
  if (( diff > 0 )); then
    action="Dr 1000 / Cr 2100 (+${diff} catch-up)"
  else
    abs=$(( -diff ))
    action="Dr 2100 / Cr 1000 (+${abs} reverse catch-up)"
  fi
  echo "| \`$wid\` | $diff | $action |"
done
echo

if [[ $APPLY -ne 1 ]]; then
  echo "## Result"
  echo
  echo "Dry-run only. Re-run with \`--apply\` to insert journals."
  {
    echo "# DB-01 dual-write harden — $STAMP"
    echo
    echo "**Result:** dry-run (not applied)"
    echo
    echo "Drifted wallets: $DRIFT_COUNT"
    echo
    echo "Re-run: \`scripts/ops-db01-journal-backfill.sh --apply\`"
  } >"$REPORT"
  echo "Wrote $REPORT"
  exit 0
fi

echo "## Applying adjusting journals"
echo '```'
APPLIED=0
for row in "${DRIFTS[@]}"; do
  wid="${row%%$'\t'*}"
  diff="${row#*$'\t'}"
  ref="db01-backfill-${wid}-${STAMP}"
  # shellcheck disable=SC2016
  if (( diff > 0 )); then
    # Dr treasury 1000 (+diff) / Cr 2100 (-diff)
    psql <<SQL
BEGIN;
WITH j AS (
  INSERT INTO ledger_journals (id, external_ref, entry_type, description, created_at)
  VALUES (gen_random_uuid(), '${ref}', 'db01_dual_write_backfill',
          'DB-01 dual-write catch-up to wallet SoT (diff=${diff})', NOW())
  RETURNING id
)
INSERT INTO ledger_journal_lines (id, journal_id, account_code, wallet_id, amount_lamports, created_at)
SELECT gen_random_uuid(), j.id, '1000', NULL, ${diff}, NOW() FROM j
UNION ALL
SELECT gen_random_uuid(), j.id, '2100', '${wid}'::uuid, -${diff}, NOW() FROM j;
COMMIT;
SQL
  else
    abs=$(( -diff ))
    # Dr 2100 (+abs) / Cr treasury 1000 (-abs)
    psql <<SQL
BEGIN;
WITH j AS (
  INSERT INTO ledger_journals (id, external_ref, entry_type, description, created_at)
  VALUES (gen_random_uuid(), '${ref}', 'db01_dual_write_backfill',
          'DB-01 dual-write catch-up to wallet SoT (diff=${diff})', NOW())
  RETURNING id
)
INSERT INTO ledger_journal_lines (id, journal_id, account_code, wallet_id, amount_lamports, created_at)
SELECT gen_random_uuid(), j.id, '2100', '${wid}'::uuid, ${abs}, NOW() FROM j
UNION ALL
SELECT gen_random_uuid(), j.id, '1000', NULL, -${abs}, NOW() FROM j;
COMMIT;
SQL
  fi
  echo "applied $ref diff=$diff"
  APPLIED=$((APPLIED + 1))
done
echo '```'
echo
echo "Applied journals: **${APPLIED}**"
echo

echo "## After: global 2100 vs wallets"
echo '```'
psql -c "
SELECT
  COALESCE((SELECT SUM(amount_lamports) FROM ledger_journal_lines WHERE account_code = '2100'), 0) AS liability_sum,
  COALESCE((SELECT SUM(balance_lamports) FROM wallets), 0) AS wallet_sum,
  COALESCE((SELECT SUM(amount_lamports) FROM ledger_journal_lines WHERE account_code = '2100'), 0)
    + COALESCE((SELECT SUM(balance_lamports) FROM wallets), 0) AS diff;
"
echo '```'
echo

AFTER_COUNT=$(psql_quiet -c "
SELECT COUNT(*)
FROM wallets w
LEFT JOIN (
  SELECT wallet_id, SUM(amount_lamports) AS liability_sum
  FROM ledger_journal_lines
  WHERE account_code = '2100' AND wallet_id IS NOT NULL
  GROUP BY wallet_id
) j ON j.wallet_id = w.id
WHERE COALESCE(j.liability_sum, 0) + w.balance_lamports <> 0;
" | tr -d '[:space:]')

echo "## After: residual drifted wallets = **${AFTER_COUNT}**"
echo

if [[ "${AFTER_COUNT}" != "0" ]]; then
  echo "\`DB01_DUAL_WRITE_HARDEN_FAIL\` — residual drift remains"
  psql -c "
SELECT w.id::text AS wallet_id,
       COALESCE(j.liability_sum, 0) + w.balance_lamports AS diff
FROM wallets w
LEFT JOIN (
  SELECT wallet_id, SUM(amount_lamports) AS liability_sum
  FROM ledger_journal_lines
  WHERE account_code = '2100' AND wallet_id IS NOT NULL
  GROUP BY wallet_id
) j ON j.wallet_id = w.id
WHERE COALESCE(j.liability_sum, 0) + w.balance_lamports <> 0
ORDER BY ABS(COALESCE(j.liability_sum, 0) + w.balance_lamports) DESC
LIMIT 20;
"
  exit 1
fi

echo "## Spot-check: no wallet balance mutation this run"
echo "(Script never UPDATEs wallets; balances unchanged by construction.)"
echo

echo "## Result"
echo
echo "\`DB01_DUAL_WRITE_HARDEN_PASS\` — dual-write 2100 catch-up complete; wallet SoT unchanged; M4 journal-as-SoT still open."
{
  echo "# DB-01 dual-write harden — $STAMP"
  echo
  echo "**Result:** \`DB01_DUAL_WRITE_HARDEN_PASS\`"
  echo
  echo "| Field | Value |"
  echo "|-------|-------|"
  echo "| Mode | APPLY |"
  echo "| Journals applied | $APPLIED |"
  echo "| Residual drift | 0 |"
  echo "| Wallet mutation | none |"
  echo "| SoT | wallets.balance_lamports (unchanged) |"
  echo "| M4 | still open (journal-as-SoT) |"
  echo
  echo "Follow-up: set \`PROXYHUB_JOURNAL_DRIFT_ALERTS=1\` (or unset) and recreate control-api."
} >"$REPORT"
echo "Wrote $REPORT"
exit 0
