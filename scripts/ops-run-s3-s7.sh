#!/usr/bin/env bash
# Orchestrate S3 + S7 on the VM after files are uploaded to /tmp.
set -euo pipefail
cd /opt/proxyhubb
mkdir -p scripts docs/ops/evidence services/control-api/internal/api services/control-api/internal/alerts \
  infra/prometheus/alerts infra/grafana/alerting

install_file() {
  local src="$1" dst="$2"
  [[ -f "$src" ]] || return 0
  mkdir -p "$(dirname "$dst")"
  tr -d '\015' <"$src" >"$dst"
  [[ "$dst" == *.sh ]] && chmod +x "$dst"
  echo "installed $dst"
}

install_file /tmp/gcp-s3-enable-observability.sh scripts/gcp-s3-enable-observability.sh
install_file /tmp/gcp-s7-evidence-pack.sh scripts/gcp-s7-evidence-pack.sh
install_file /tmp/nats-lag.yml infra/prometheus/alerts/nats-lag.yml
install_file /tmp/contact-points.yml infra/grafana/alerting/contact-points.yml
install_file /tmp/notification-policies.yml infra/grafana/alerting/notification-policies.yml
install_file /tmp/internal_alerts_webhook.go services/control-api/internal/api/internal_alerts_webhook.go
install_file /tmp/channels.go services/control-api/internal/alerts/channels.go
install_file /tmp/main.go services/control-api/main.go
install_file /tmp/docker-compose.gcp-testnet.yml docker-compose.gcp-testnet.yml
# Patch alert env keys into live docker-compose.yml if missing
if ! grep -q INTERNAL_ALERT_WEBHOOK_TOKEN docker-compose.yml; then
  python3 - <<'PY'
from pathlib import Path
p = Path("docker-compose.yml")
t = p.read_text()
needle = "      - PAGERDUTY_ROUTING_KEY=${PAGERDUTY_ROUTING_KEY:-}\n"
insert = needle + "      - INTERNAL_ALERT_WEBHOOK_TOKEN=${INTERNAL_ALERT_WEBHOOK_TOKEN:-}\n"
if needle in t and "INTERNAL_ALERT_WEBHOOK_TOKEN" not in t:
    p.write_text(t.replace(needle, insert, 1))
    print("docker-compose.yml: INTERNAL_ALERT_WEBHOOK_TOKEN added")
else:
    print("docker-compose.yml: no change")
PY
fi

bash scripts/gcp-s3-enable-observability.sh
bash scripts/gcp-s7-evidence-pack.sh
echo OPS_S3_S7_DONE
ls -la docs/ops/evidence | tail -20
