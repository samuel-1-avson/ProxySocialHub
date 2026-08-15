#!/usr/bin/env bash
# S3: enable observability + platform-native alerts (no Slack / PagerDuty).
# Delivery path: logs → ops_alerts journal → NATS proxy.ops.v1.alerts
#                ← Grafana contact point → POST /internal/alerts/webhook
#
# Usage (on VM):
#   sudo bash scripts/gcp-s3-enable-observability.sh
# Optional:
#   ALERT_WEBHOOK_URL=https://ntfy.example/topic  (self-hosted only)
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
cd "$PROJECT_DIR"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
OUT_DIR="$PROJECT_DIR/docs/ops/evidence"
mkdir -p "$OUT_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
REPORT="$OUT_DIR/S3_observability_${STAMP}.md"

upsert_env() {
  local key="$1" val="$2"
  local tmp
  tmp=$(mktemp)
  if grep -qE "^${key}=" .env 2>/dev/null; then
    awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' .env >"$tmp"
    mv "$tmp" .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
}

env_set_nonempty() {
  local key="$1"
  grep -E "^${key}=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' | grep -q .
}

echo "=== S3: strip centralized SaaS alert channels ==="
# Explicitly clear any prior Slack/PagerDuty wiring (decentralization policy).
upsert_env SLACK_ALERT_WEBHOOK_URL ""
upsert_env PAGERDUTY_ROUTING_KEY ""

if [[ -n "${ALERT_WEBHOOK_URL:-}" ]]; then
  upsert_env ALERT_WEBHOOK_URL "$ALERT_WEBHOOK_URL"
fi

if ! env_set_nonempty GRAFANA_ADMIN_PASSWORD; then
  upsert_env GRAFANA_ADMIN_PASSWORD "$(openssl rand -hex 16)"
  echo "GRAFANA_ADMIN_PASSWORD generated (stored in .env)"
fi

if ! env_set_nonempty INTERNAL_ALERT_WEBHOOK_TOKEN; then
  gw=$(grep -E '^GATEWAY_SHARED_SECRET=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
  if [[ -n "$gw" ]]; then
    upsert_env INTERNAL_ALERT_WEBHOOK_TOKEN "$gw"
  else
    upsert_env INTERNAL_ALERT_WEBHOOK_TOKEN "$(openssl rand -hex 24)"
  fi
fi

if grep -qE '^COMPOSE_PROFILES=' .env 2>/dev/null; then
  cur=$(grep -E '^COMPOSE_PROFILES=' .env | head -1 | cut -d= -f2- | tr -d '\r')
  case ",$cur," in
    *,observability,*) ;;
    *) upsert_env COMPOSE_PROFILES "${cur:+$cur,}observability" ;;
  esac
else
  upsert_env COMPOSE_PROFILES observability
fi

echo "=== S3: apply ops_alerts migration ==="
if [[ -f migrations/000143_ops_alerts.up.sql ]]; then
  "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 \
    < migrations/000143_ops_alerts.up.sql || true
  "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c \
    "SELECT to_regclass('public.ops_alerts');" | grep -q ops_alerts && echo "ops_alerts=ok" || echo "ops_alerts=MISSING"
fi

echo "=== S3: start observability profile ==="
export COMPOSE_PROFILES=observability
"${COMPOSE[@]}" --profile observability up -d redis-exporter prometheus grafana

echo "=== S3: recreate control-api for alert package ==="
"${COMPOSE[@]}" up -d --no-deps --force-recreate --build control-api

for i in $(seq 1 36); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "try=$i api=$st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done

sleep 8
echo "=== S3: verify ==="
API_ALERTS=$("${COMPOSE[@]}" logs control-api --since 3m 2>/dev/null \
  | grep -Ei 'Alert channels ready|ops_alerts|Slack|PagerDuty|No alert channels' | tail -5 || true)
PROM_UP=$(curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:9091/-/ready || echo fail)
GRAF_UP=$(curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/health || echo fail)

TOKEN=$("${COMPOSE[@]}" exec -T control-api printenv INTERNAL_ALERT_WEBHOOK_TOKEN 2>/dev/null | tr -d '\r' || true)
[[ -z "$TOKEN" ]] && TOKEN=$("${COMPOSE[@]}" exec -T control-api printenv GATEWAY_SHARED_SECRET 2>/dev/null | tr -d '\r' || true)
WH_CODE="skip"
RECENT_CODE="skip"
JOURNAL_ROWS="0"
if [[ -n "$TOKEN" ]]; then
  WH_CODE=$(curl -sS -o /tmp/wh.out -w '%{http_code}' \
    -X POST http://127.0.0.1:8080/internal/alerts/webhook \
    -H "Content-Type: application/json" \
    -H "X-Alert-Token: $TOKEN" \
    -d '{"title":"S3 platform alert probe","state":"alerting","message":"durable journal + NATS path"}' || echo fail)
  sleep 1
  RECENT_CODE=$(curl -sS -o /tmp/recent.out -w '%{http_code}' \
    http://127.0.0.1:8080/internal/alerts/recent \
    -H "X-Alert-Token: $TOKEN" || echo fail)
  JOURNAL_ROWS=$("${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c \
    "SELECT COUNT(*) FROM ops_alerts;" 2>/dev/null | tr -d '\r' || echo 0)
fi

SLACK_CLEARED=true
grep -E '^SLACK_ALERT_WEBHOOK_URL=.+' .env 2>/dev/null | grep -vqE '=$' && SLACK_CLEARED=false || true
PD_CLEARED=true
grep -E '^PAGERDUTY_ROUTING_KEY=.+' .env 2>/dev/null | grep -vqE '=$' && PD_CLEARED=false || true

VERDICT="FAIL"
if [[ "$PROM_UP" == "200" && "$GRAF_UP" == "200" && "$WH_CODE" == "200" && "$JOURNAL_ROWS" != "0" && "$SLACK_CLEARED" == "true" ]]; then
  VERDICT="PASS"
elif [[ "$PROM_UP" == "200" && "$GRAF_UP" == "200" && "$WH_CODE" == "200" ]]; then
  VERDICT="PARTIAL_JOURNAL_PENDING"
fi

{
  echo "# S3 Observability (platform-native alerts) — $STAMP"
  echo
  echo "| Check | Result |"
  echo "|-------|--------|"
  echo "| Verdict | **$VERDICT** |"
  echo "| Prometheus ready | \`$PROM_UP\` |"
  echo "| Grafana health | \`$GRAF_UP\` |"
  echo "| Slack cleared | \`$SLACK_CLEARED\` |"
  echo "| PagerDuty cleared | \`$PD_CLEARED\` |"
  echo "| Internal webhook probe | HTTP \`$WH_CODE\` |"
  echo "| Recent alerts API | HTTP \`$RECENT_CODE\` |"
  echo "| ops_alerts rows | \`$JOURNAL_ROWS\` |"
  echo
  echo "## Model"
  echo "- Durable journal: \`ops_alerts\`"
  echo "- Bus: NATS subject \`proxy.ops.v1.alerts\` (JetStream OPS stream)"
  echo "- Grafana → \`POST /internal/alerts/webhook\` (already in contact-points.yml)"
  echo "- **No Slack / PagerDuty** (centralized SaaS removed from S3 DoD)"
  echo
  echo "## control-api alert log"
  echo '```'
  echo "$API_ALERTS"
  echo '```'
} | tee "$REPORT"

echo "S3_REPORT=$REPORT"
echo "S3_VERDICT=$VERDICT"
echo S3_ENABLE_DONE
