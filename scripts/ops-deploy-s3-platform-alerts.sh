#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
for f in /tmp/000143_ops_alerts.up.sql /tmp/000143_ops_alerts.down.sql \
         /tmp/channels.go /tmp/channels_test.go \
         /tmp/internal_alerts_webhook.go /tmp/connector.go \
         /tmp/gcp-s3-enable-observability.sh; do
  sed -i 's/\r$//' "$f" 2>/dev/null || true
done
cp /tmp/000143_ops_alerts.up.sql migrations/
cp /tmp/000143_ops_alerts.down.sql migrations/
cp /tmp/channels.go services/control-api/internal/alerts/
cp /tmp/channels_test.go services/control-api/internal/alerts/
cp /tmp/internal_alerts_webhook.go services/control-api/internal/api/
cp /tmp/connector.go services/control-api/internal/nats/
cp /tmp/gcp-s3-enable-observability.sh scripts/
chmod +x scripts/gcp-s3-enable-observability.sh
# Also clear Slack from live compose env if present in docker-compose.yml on box
if grep -q 'SLACK_ALERT_WEBHOOK_URL' docker-compose.yml 2>/dev/null; then
  echo "NOTE: docker-compose.yml on VM still mentions Slack — prefer rebuilt image env from ALERT_WEBHOOK_URL"
fi
bash scripts/gcp-s3-enable-observability.sh
