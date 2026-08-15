#!/usr/bin/env bash
# Deploy Phase 1b session escrow PDA control-api + migration to GCP testnet.
# Program upgrade (initialize_session_escrow / settle_session_escrow) must be done separately.
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
[[ -d "$tmpdir/solana-programs" ]] && mkdir -p "$PROJECT_DIR/services/solana-programs" && cp -a "$tmpdir/solana-programs/." "$PROJECT_DIR/services/solana-programs/"
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
for f in docker-compose.yml docker-compose.gcp-testnet.yml; do
  [[ -f "$PROJECT_DIR/$f" ]] && strip_cr "$PROJECT_DIR/$f"
done

grep -q 'PROXYHUB_REQUIRE_SESSION_PDA' "$PROJECT_DIR/docker-compose.yml"
grep -q 'initialize_session_escrow' "$PROJECT_DIR/services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs" \
  || grep -q 'SettleSessionEscrow' "$PROJECT_DIR/services/control-api/internal/solana/session_escrow.go"
grep -q 'fundSessionSolana' "$PROJECT_DIR/services/control-api/internal/api/sessions_session_escrow.go"
grep -q 'shouldSettleOnChainSessionPDA' "$PROJECT_DIR/services/control-api/internal/billing/worker.go"
test -f "$PROJECT_DIR/migrations/000135_sessions_session_pda.up.sql"
echo SOURCES_OK

if [[ -f "$PROJECT_DIR/.env" ]]; then
  if grep -q '^PROXYHUB_REQUIRE_SESSION_PDA=' "$PROJECT_DIR/.env"; then
    sed -i 's/^PROXYHUB_REQUIRE_SESSION_PDA=.*/PROXYHUB_REQUIRE_SESSION_PDA=false/' "$PROJECT_DIR/.env"
  else
    echo 'PROXYHUB_REQUIRE_SESSION_PDA=false' >> "$PROJECT_DIR/.env"
  fi
fi

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

# Apply migration 000135
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 \
  -f - < "$PROJECT_DIR/migrations/000135_sessions_session_pda.up.sql" \
  || "${COMPOSE[@]}" exec -T -e PGPASSWORD=admin postgres \
       psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 \
       -c "$(tr -d '\015' < "$PROJECT_DIR/migrations/000135_sessions_session_pda.up.sql")"

"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "\d sessions" | grep -E 'session_pda|payment_method' || true
"${COMPOSE[@]}" exec -T control-api sh -c 'printenv PROXYHUB_REQUIRE_SESSION_PDA' | tr -d '\r'
echo PHASE1B_CONTROL_API_DEPLOY_DONE
