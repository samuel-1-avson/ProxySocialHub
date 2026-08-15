#!/usr/bin/env bash
# Deploy traffic-first pricing: control-api + web + migration 000128 backfill.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DEPLOY_TAR="${DEPLOY_TAR:?Set DEPLOY_TAR}"
DOCKER="${DOCKER:-docker}"

cd "$PROJECT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Extracting $DEPLOY_TAR"
tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"

if [[ -d "$tmpdir/migrations" ]]; then
  mkdir -p "$PROJECT_DIR/migrations"
  cp -a "$tmpdir/migrations/." "$PROJECT_DIR/migrations/"
fi
if [[ -d "$tmpdir/control-api" ]]; then
  mkdir -p "$PROJECT_DIR/services/control-api"
  cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
fi
if [[ -d "$tmpdir/web" ]]; then
  mkdir -p "$PROJECT_DIR/apps/web"
  cp -a "$tmpdir/web/." "$PROJECT_DIR/apps/web/"
fi
rm -rf "$tmpdir"

find "$PROJECT_DIR/services/control-api" "$PROJECT_DIR/apps/web" "$PROJECT_DIR/migrations" \
  -type f \( -name '*.go' -o -name '*.ts' -o -name '*.tsx' -o -name '*.sql' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

test -f "$PROJECT_DIR/migrations/000128_traffic_first_pricing.up.sql"
grep -q 'ListingPriceHardCapUSD' "$PROJECT_DIR/services/control-api/internal/core/services/pricing_oracle.go"
grep -q 'baseRate = 0.99' "$PROJECT_DIR/services/control-api/internal/core/services/pricing_oracle.go"
grep -q 'suggested: 0.99' "$PROJECT_DIR/apps/web/src/lib/listing-price.ts"
grep -q 'getSuggestedListingPrice' "$PROJECT_DIR/apps/web/src/lib/api/marketplace.ts"
grep -q 'pricePerGB := 0.99' "$PROJECT_DIR/services/control-api/internal/api/provider_nodes.go"

COMPOSE=(
  "$DOCKER" compose
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)

cd "$PROJECT_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building db-migrate control-api web"
"${COMPOSE[@]}" build db-migrate control-api web

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running db-migrate (000128 pricing backfill)"
"${COMPOSE[@]}" run --rm --no-deps db-migrate

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Recreating control-api + web"
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api web

for svc in control-api web; do
  ok=0
  for i in $(seq 1 90); do
    st=$("${COMPOSE[@]}" ps "$svc" --format '{{.Status}}' 2>/dev/null || true)
    echo "try=$i $svc $st"
    if echo "$st" | grep -qi healthy; then
      echo "$svc HEALTHY"
      ok=1
      break
    fi
    sleep 5
  done
  if [[ "$ok" != "1" ]]; then
    echo "$svc failed healthy" >&2
    "${COMPOSE[@]}" logs --tail=100 "$svc" || true
    exit 1
  fi
done

echo "=== verify ==="
curl -sS -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health || true
curl -sS -o /dev/null -w "web_home=%{http_code}\n" http://127.0.0.1:3000/ || true
curl -sS "http://127.0.0.1:8080/v1/suggest-price?country=US&proxy_type=residential" | head -c 400 || true
echo
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT proxy_type, ROUND(AVG(price_per_gb)::numeric,4) AS avg_usd, ROUND(MIN(price_per_gb)::numeric,4) AS min_usd, ROUND(MAX(price_per_gb)::numeric,4) AS max_usd, COUNT(*) FROM proxy_listings WHERE status <> 'deleted' GROUP BY 1 ORDER BY 1;" \
  || true
echo "TRAFFIC_FIRST_PRICING_DEPLOY_DONE"
