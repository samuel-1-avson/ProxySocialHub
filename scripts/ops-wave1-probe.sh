#!/usr/bin/env bash
# Wave-1 probe: Slack wiring status + money alert samples + IMAGE_TAG / backup hints.
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
cd "$PROJECT_DIR"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== WAVE1_PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

echo "=== .env alert keys (redacted) ==="
for k in SLACK_ALERT_WEBHOOK_URL PAGERDUTY_ROUTING_KEY INTERNAL_ALERT_WEBHOOK_TOKEN COMPOSE_PROFILES IMAGE_TAG; do
  if grep -qE "^${k}=" .env 2>/dev/null; then
    v=$(grep -E "^${k}=" .env | head -1 | cut -d= -f2- | tr -d '\r')
    if [[ -z "$v" ]]; then
      echo "$k=EMPTY"
    elif [[ "$k" == "IMAGE_TAG" || "$k" == "COMPOSE_PROFILES" ]]; then
      echo "$k=$v"
    else
      echo "$k=SET len=${#v}"
    fi
  else
    echo "$k=MISSING"
  fi
done

echo "=== Secret Manager slack/pager (names only) ==="
gcloud secrets list --project=gen-lang-client-0022105784 --format='value(name)' 2>/dev/null \
  | grep -Ei 'slack|pager|alert' || echo "(none matching)"

echo "=== observability containers ==="
"${COMPOSE[@]}" ps prometheus grafana 2>/dev/null || true

echo "=== recent money alerts (6h) ==="
"${COMPOSE[@]}" logs --since=6h control-api 2>/dev/null \
  | grep -Ei 'treasury deficit|journal drift|ledger.*discrep|alert_title|alert_level' \
  | tail -40 || echo "(no matches)"

echo "=== docker IMAGE_TAG / running images (control-api web) ==="
"${COMPOSE[@]}" images control-api web 2>/dev/null | head -20 || true
docker inspect "$("${COMPOSE[@]}" ps -q control-api 2>/dev/null | head -1)" --format '{{.Config.Image}}' 2>/dev/null || true

echo "=== postgres backup artifacts ==="
ls -lah /opt/proxyhubb/backups 2>/dev/null | tail -15 || ls -lah /var/backups/proxyhubb 2>/dev/null | tail -15 || echo "(no backup dir found)"
find /opt/proxyhubb -maxdepth 3 -name '*.sql*' -o -name '*pg_dump*' 2>/dev/null | head -20 || true

echo "=== control-api health ==="
curl -sfS -m 5 http://127.0.0.1:8080/healthz || curl -sfS -m 5 http://127.0.0.1:8080/health || echo "health_fail"

echo WAVE1_PROBE_DONE
