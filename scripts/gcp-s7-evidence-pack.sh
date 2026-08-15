#!/usr/bin/env bash
# S7: live custody + migration evidence pack for proxyhubb-testnet.
# Usage (on VM): sudo bash scripts/gcp-s7-evidence-pack.sh
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
cd "$PROJECT_DIR"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
OUT_DIR="$PROJECT_DIR/docs/ops/evidence"
mkdir -p "$OUT_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
REPORT="$OUT_DIR/S7_custody_migrations_${STAMP}.md"

env_of() { "${COMPOSE[@]}" exec -T control-api printenv "$1" 2>/dev/null | tr -d '\r' || true; }
psqlq() {
  "${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-proxyhubb}" -d "${POSTGRES_DB:-proxyhubb}" -At -c "$1" | tr -d '\r'
}
psqlc() {
  "${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-proxyhubb}" -d "${POSTGRES_DB:-proxyhubb}" -c "$1"
}

pass=0
fail=0
soft=0
check() {
  local name="$1" ok="$2" detail="${3:-}"
  if [[ "$ok" == "1" ]]; then
    echo "| $name | PASS | $detail |"
    pass=$((pass+1))
  elif [[ "$ok" == "soft" ]]; then
    echo "| $name | SOFT | $detail |"
    soft=$((soft+1))
  else
    echo "| $name | FAIL | $detail |"
    fail=$((fail+1))
  fi
}

echo "=== gathering S7 evidence ==="

# Migrations
MIG_LIST=$(psqlq "SELECT version FROM schema_migrations WHERE version ~ '000116|000124|000137|000138' ORDER BY version;" || true)
has_mig() { echo "$MIG_LIST" | grep -q "$1" && echo 1 || echo 0; }

# Tables / triggers for journal + append-only
HAS_JOURNAL=$(psqlq "SELECT CASE WHEN to_regclass('public.ledger_journal_lines') IS NOT NULL THEN 1 ELSE 0 END;")
HAS_LAMPORTS=$(psqlq "SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='wallets' AND column_name='balance_lamports') THEN 1 ELSE 0 END;")
APPEND_TG=$(psqlq "SELECT COUNT(*) FROM pg_trigger WHERE tgrelid='public.wallet_ledger_entries'::regclass AND (tgname LIKE '%append_only%' OR tgname LIKE '%prevent_wallet_ledger%');" || echo 0)

# Custody addresses from live API + env
curl -fsS http://127.0.0.1:8080/v1/system/config/public -o /tmp/s7_public.json 2>/dev/null || echo '{}' >/tmp/s7_public.json
eval "$(python3 - <<'PY'
import json
d = json.load(open("/tmp/s7_public.json"))
def esc(v):
    return str(v or "").replace("'", "'\"'\"'")
print(f"DEP='{esc(d.get('deposit_address') or d.get('vault_address'))}'")
print(f"DEST='{esc(d.get('destination_kind'))}'")
print(f"TREAS_PUB='{esc(d.get('treasury_solana'))}'")
PY
)"

ORACLE=$(env_of GCP_KMS_PUBLIC_KEY)
[[ -z "$ORACLE" ]] && ORACLE=$(env_of SOLANA_ORACLE_PUBKEY)
HOT=$(env_of SOLANA_TREASURY_HOT_ADDRESS)
[[ -z "$HOT" ]] && HOT=$(env_of GCP_KMS_HOT_PUBLIC_KEY)
COLD=$(env_of SOLANA_TREASURY_COLD_ADDRESS)
VAULT_ENV=$(env_of SOLANA_TREASURY_ADDRESS)
[[ -z "$DEP" ]] && DEP="$VAULT_ENV"

USE_GCP=$(env_of USE_GCP_KMS)
REQ_GCP=$(env_of PROXYHUB_REQUIRE_GCP_KMS)
KMS_KEY=$(env_of GCP_KMS_KEY_NAME)
USE_HOT=$(env_of USE_GCP_KMS_HOT)
REQ_HOT=$(env_of PROXYHUB_REQUIRE_GCP_KMS_HOT)
HOT_KEY=$(env_of GCP_KMS_HOT_KEY_NAME)
ORACLE_FILE=$(env_of SOLANA_ORACLE_KEYPAIR)
HOT_FILE=$(env_of SOLANA_TREASURY_HOT_KEYPAIR)

FINALIZED=$(env_of PROXYHUB_DEPOSIT_REQUIRE_FINALIZED)
VAULT_UI=$(env_of PROXYHUB_DEPOSIT_VAULT_UI)
VAULT_CREDIT=$(env_of PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED)
LEGACY=$(env_of PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT)
REQ_ESCROW=$(env_of PROXYHUB_REQUIRE_ESCROW_PDA)

# Distinctness
uniq_count=$(printf '%s\n' "$DEP" "$HOT" "$ORACLE" "$COLD" | sed '/^$/d' | sort -u | wc -l | tr -d ' ')
vault_eq_hot=0; [[ -n "$DEP" && "$DEP" == "$HOT" ]] && vault_eq_hot=1
vault_eq_oracle=0; [[ -n "$DEP" && "$DEP" == "$ORACLE" ]] && vault_eq_oracle=1
hot_eq_oracle=0; [[ -n "$HOT" && "$HOT" == "$ORACLE" ]] && hot_eq_oracle=1
cold_eq_hot=0; [[ -n "$COLD" && "$COLD" == "$HOT" ]] && cold_eq_hot=1

# File key quarantine (Sprint H): empty paths preferred when KMS required
file_keys_empty=1
[[ -n "$ORACLE_FILE" || -n "$HOT_FILE" ]] && file_keys_empty=0

# On-chain balances (best-effort via solana CLI if present, else RPC)
RPC=$(env_of SOLANA_RPC_URL)
[[ -z "$RPC" ]] && RPC="https://api.devnet.solana.com"
bal_line() {
  local addr="$1" label="$2"
  [[ -z "$addr" ]] && { echo "$label=<unset>"; return; }
  local body
  body=$(curl -fsS "$RPC" -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"$addr\"]}" 2>/dev/null || true)
  echo "$label=$addr raw=$(echo "$body" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("result",{}).get("value","?"))' 2>/dev/null || echo '?')"
}

HEALTH=$(curl -fsS http://127.0.0.1:8080/v1/health/system 2>/dev/null | head -c 400 || true)

{
  echo "# S7 Custody + Migration Evidence — $STAMP"
  echo
  echo "Host: \`$(hostname)\` · Project dir: \`$PROJECT_DIR\`"
  echo
  echo "## Summary checks"
  echo "| Check | Result | Detail |"
  echo "|-------|--------|--------|"
} > "$REPORT"

# Append checks into report via function redirect
{
  check "migration 000116" "$(has_mig 000116_ledger_append_only_lamports)" "$(echo "$MIG_LIST" | tr '\n' ' ')"
  check "migration 000124" "$(has_mig 000124_ledger_journal)" ""
  check "migration 000137" "$(has_mig 000137_ledger_revoke_app_mutate)" ""
  check "migration 000138" "$(has_mig 000138_ledger_revoke_truncate)" ""
  check "ledger_journal_lines table" "$HAS_JOURNAL" ""
  check "wallets.balance_lamports" "$HAS_LAMPORTS" ""
  [[ "${APPEND_TG:-0}" -ge 1 ]] && check "append-only trigger" 1 "count=$APPEND_TG" || check "append-only trigger" 0 "count=$APPEND_TG"

  [[ "$DEST" == "vault" ]] && check "destination_kind=vault" 1 "$DEST" || check "destination_kind=vault" 0 "$DEST"
  [[ "$VAULT_UI" == "true" ]] && check "DEPOSIT_VAULT_UI" 1 || check "DEPOSIT_VAULT_UI" 0 "$VAULT_UI"
  [[ "$VAULT_CREDIT" == "true" ]] && check "DEPOSIT_VAULT_CREDIT" 1 || check "DEPOSIT_VAULT_CREDIT" 0 "$VAULT_CREDIT"
  [[ "$LEGACY" == "false" ]] && check "LEGACY_TREASURY_CREDIT=false" 1 || check "LEGACY_TREASURY_CREDIT=false" 0 "$LEGACY"
  [[ "$FINALIZED" == "true" ]] && check "DEPOSIT_REQUIRE_FINALIZED" 1 || check "DEPOSIT_REQUIRE_FINALIZED" 0 "$FINALIZED"
  [[ "$REQ_ESCROW" == "true" ]] && check "REQUIRE_ESCROW_PDA" 1 || check "REQUIRE_ESCROW_PDA" 0 "$REQ_ESCROW"

  [[ "$USE_GCP" == "true" && "$REQ_GCP" == "true" && -n "$KMS_KEY" && -n "$ORACLE" ]] \
    && check "oracle GCP KMS fail-closed" 1 "pubkey=${ORACLE:0:8}… key_set=yes" \
    || check "oracle GCP KMS fail-closed" 0 "USE=$USE_GCP REQ=$REQ_GCP key_len=${#KMS_KEY} oracle_len=${#ORACLE}"
  [[ "$USE_HOT" == "true" && "$REQ_HOT" == "true" && -n "$HOT_KEY" && -n "$HOT" ]] \
    && check "hot GCP KMS fail-closed" 1 "pubkey=${HOT:0:8}…" \
    || check "hot GCP KMS fail-closed" 0 "USE=$USE_HOT REQ=$REQ_HOT"

  [[ "$vault_eq_hot" == "0" && -n "$DEP" && -n "$HOT" ]] && check "vault ≠ hot" 1 "vault=${DEP:0:8}… hot=${HOT:0:8}…" || check "vault ≠ hot" 0 "vault=$DEP hot=$HOT"
  [[ "$vault_eq_oracle" == "0" && -n "$DEP" && -n "$ORACLE" ]] && check "vault ≠ oracle" 1 || check "vault ≠ oracle" 0
  [[ "$hot_eq_oracle" == "0" && -n "$HOT" && -n "$ORACLE" ]] && check "hot ≠ oracle" 1 || check "hot ≠ oracle" 0
  if [[ -n "$COLD" ]]; then
    [[ "$cold_eq_hot" == "0" ]] && check "cold ≠ hot" 1 "cold=${COLD:0:8}…" || check "cold ≠ hot" 0
  else
    check "cold configured" soft "SOLANA_TREASURY_COLD_ADDRESS empty"
  fi
  [[ "$file_keys_empty" == "1" ]] && check "no oracle/hot file keypaths in container" 1 || check "no oracle/hot file keypaths in container" soft "oracle_file='$ORACLE_FILE' hot_file='$HOT_FILE'"

  echo
  echo "## Address inventory (public / env)"
  echo '```'
  echo "destination_kind=$DEST"
  echo "deposit_vault=$DEP"
  echo "treasury_solana_public=$TREAS_PUB"
  echo "hot=$HOT"
  echo "oracle=$ORACLE"
  echo "cold=$COLD"
  echo "distinct_nonempty_count=$uniq_count"
  echo '```'
  echo
  echo "## Devnet balances (lamports)"
  echo '```'
  bal_line "$DEP" vault
  bal_line "$HOT" hot
  bal_line "$ORACLE" oracle
  bal_line "$COLD" cold
  echo '```'
  echo
  echo "## schema_migrations (target set)"
  echo '```'
  echo "$MIG_LIST"
  echo '```'
  echo
  echo "## system health (truncated)"
  echo '```'
  echo "$HEALTH"
  echo '```'
  echo
  echo "## KMS flags"
  echo '```'
  echo "USE_GCP_KMS=$USE_GCP"
  echo "PROXYHUB_REQUIRE_GCP_KMS=$REQ_GCP"
  echo "GCP_KMS_KEY_NAME_set=$([[ -n $KMS_KEY ]] && echo yes || echo no)"
  echo "USE_GCP_KMS_HOT=$USE_HOT"
  echo "PROXYHUB_REQUIRE_GCP_KMS_HOT=$REQ_HOT"
  echo "GCP_KMS_HOT_KEY_NAME_set=$([[ -n $HOT_KEY ]] && echo yes || echo no)"
  echo '```'
  echo
  VERDICT="PASS"
  [[ "$fail" -gt 0 ]] && VERDICT="FAIL"
  [[ "$fail" -eq 0 && "$soft" -gt 0 ]] && VERDICT="PASS_WITH_SOFT"
  echo "## Verdict"
  echo
  echo "**$VERDICT** — pass=$pass fail=$fail soft=$soft"
  echo
  echo "S7_VERDICT=$VERDICT"
} | tee -a "$REPORT"

echo "S7_REPORT=$REPORT"
echo S7_EVIDENCE_DONE
