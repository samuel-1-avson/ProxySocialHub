#!/usr/bin/env bash
# Deploy deposit cutover + intent PDA settle + phase2 ledger migrations to GCP testnet.
# Usage on VM:
#   DEPLOY_TAR=/tmp/cutover-phase2.tar.gz bash scripts/gcp-deploy-cutover-phase2.sh
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DEPLOY_TAR="${DEPLOY_TAR:?}"
DOCKER="${DOCKER:-docker}"
cd "$PROJECT_DIR"

tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"
[[ -d "$tmpdir/control-api" ]] && cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
if [[ -d "$tmpdir/migrations" ]]; then
  cp -a "$tmpdir/migrations/." "$PROJECT_DIR/migrations/"
fi
for f in docker-compose.yml docker-compose.gcp-testnet.yml; do
  [[ -f "$tmpdir/$f" ]] && cp -a "$tmpdir/$f" "$PROJECT_DIR/$f"
done
[[ -f "$tmpdir/scripts/gcp-cutover-deposit-vault.sh" ]] && \
  mkdir -p "$PROJECT_DIR/scripts" && \
  cp -a "$tmpdir/scripts/gcp-cutover-deposit-vault.sh" "$PROJECT_DIR/scripts/"
[[ -f "$tmpdir/scripts/set-proxyhub-upgrade-authority.sh" ]] && \
  cp -a "$tmpdir/scripts/set-proxyhub-upgrade-authority.sh" "$PROJECT_DIR/scripts/"
rm -rf "$tmpdir"

strip_cr() {
  local f="$1" tmpf
  tmpf=$(mktemp)
  tr -d '\015' < "$f" > "$tmpf" && mv "$tmpf" "$f"
}
find "$PROJECT_DIR/services/control-api" -type f -name '*.go' -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do strip_cr "$f"; done
find "$PROJECT_DIR/migrations" -type f -name '*.sql' -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do strip_cr "$f"; done
for f in docker-compose.yml docker-compose.gcp-testnet.yml \
         scripts/gcp-cutover-deposit-vault.sh scripts/set-proxyhub-upgrade-authority.sh; do
  [[ -f "$PROJECT_DIR/$f" ]] && strip_cr "$PROJECT_DIR/$f"
done

grep -q 'SettleSessionIntent' "$PROJECT_DIR/services/control-api/internal/settlement/intent.go"
grep -q 'shouldSettleOnChainIntentPDA' "$PROJECT_DIR/services/control-api/internal/settlement/intent.go"
grep -q 'BestEffortPublishIntentReceipt' "$PROJECT_DIR/services/control-api/internal/settlement/intent.go"
grep -q 'fundSessionIntentSolana' "$PROJECT_DIR/services/control-api/internal/api/session_intent_escrow.go"
grep -q 'PostUsageJournal' "$PROJECT_DIR/services/control-api/internal/models/ledger_journal.go"
test -f "$PROJECT_DIR/migrations/000136_session_intents_session_pda.up.sql"
test -f "$PROJECT_DIR/migrations/000137_ledger_revoke_app_mutate.up.sql"
echo SOURCES_OK

# Deposit cutover flags (vault UI on, legacy credit frozen)
set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}
set_env PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED true
set_env PROXYHUB_DEPOSIT_VAULT_UI true
set_env PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT false
# Keep session PDA required (phase 1b)
set_env PROXYHUB_REQUIRE_SESSION_PDA true

COMPOSE=("$DOCKER" compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

for i in $(seq 1 60); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "try=$i $st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done
echo "$st" | grep -qi healthy

apply_sql() {
  local f="$1"
  "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 -f - < "$f" \
    || "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 \
         -c "$(tr -d '\015' < "$f")"
}

apply_sql "$PROJECT_DIR/migrations/000136_session_intents_session_pda.up.sql"
apply_sql "$PROJECT_DIR/migrations/000137_ledger_revoke_app_mutate.up.sql"

"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "\d session_intents" | grep -E 'session_pda|payment_method' || true
"${COMPOSE[@]}" exec -T control-api sh -c 'printenv PROXYHUB_DEPOSIT_VAULT_UI PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT PROXYHUB_REQUIRE_SESSION_PDA' | tr -d '\r'
curl -fsS http://127.0.0.1:8080/v1/system/config/public | head -c 500 || true
echo
echo CUTOVER_PHASE2_DEPLOY_DONE
