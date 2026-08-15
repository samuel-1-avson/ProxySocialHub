#!/usr/bin/env bash
# Deploy escrow PDA enforcement cutover to GCP testnet.
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
[[ -f "$tmpdir/docs/custody-split.md" ]] && mkdir -p "$PROJECT_DIR/docs" && cp -a "$tmpdir/docs/custody-split.md" "$PROJECT_DIR/docs/"
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

grep -q 'PROXYHUB_REQUIRE_ESCROW_PDA' "$PROJECT_DIR/docker-compose.yml"
grep -q 'PROXYHUB_REQUIRE_ESCROW_PDA' "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
grep -q 'escrow_pda_required' "$PROJECT_DIR/services/control-api/internal/api/orders_confirm_escrow.go"
grep -q 'shouldSkipCustodialSettleForEscrow' "$PROJECT_DIR/services/control-api/internal/billing/worker.go"
test -f "$PROJECT_DIR/migrations/000134_orders_escrow_pda_index.up.sql"
echo SOURCES_OK

# Ensure host .env has the flag for compose interpolation clarity
if [[ -f "$PROJECT_DIR/.env" ]]; then
  if grep -q '^PROXYHUB_REQUIRE_ESCROW_PDA=' "$PROJECT_DIR/.env"; then
    sed -i 's/^PROXYHUB_REQUIRE_ESCROW_PDA=.*/PROXYHUB_REQUIRE_ESCROW_PDA=true/' "$PROJECT_DIR/.env"
  else
    echo 'PROXYHUB_REQUIRE_ESCROW_PDA=true' >> "$PROJECT_DIR/.env"
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

echo "=== apply migration 000134 ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb \
  < "$PROJECT_DIR/migrations/000134_orders_escrow_pda_index.up.sql"
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT indexname FROM pg_indexes WHERE indexname='idx_orders_escrow_pda';"

echo "=== flag in container ==="
FLAG=$("${COMPOSE[@]}" exec -T control-api printenv PROXYHUB_REQUIRE_ESCROW_PDA | tr -d '\r')
echo "PROXYHUB_REQUIRE_ESCROW_PDA=$FLAG"
[[ "$FLAG" == "true" ]]

echo "=== audit orders without PDA ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT status, COUNT(*) FROM orders WHERE escrow_pda IS NULL OR escrow_pda='' GROUP BY status ORDER BY count DESC LIMIT 20;"

echo "=== activate-dev should 404 when flag on ==="
curl -sS -o /tmp/activate-dev.json -w 'HTTP=%{http_code}\n' \
  -X POST http://127.0.0.1:18080/v1/orders/00000000-0000-0000-0000-000000000001/activate-dev \
  -H 'Content-Type: application/json' || true
head -c 200 /tmp/activate-dev.json; echo

echo "=== public treasury still up ==="
curl -sS http://127.0.0.1:18080/v1/treasury/public | head -c 300; echo

echo ESCROW_PDA_CUTOVER_DONE
