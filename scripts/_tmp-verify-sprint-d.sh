#!/usr/bin/env bash
set -euo pipefail
echo "=== cron ==="
ls -la /etc/cron.d/proxyhubb-* 2>/dev/null || true
echo "=== nats volume ==="
sudo docker volume ls | grep nats || true
echo "=== mem limits (bytes) ==="
sudo docker inspect proxyhubb-control-api-1 --format 'api MemLimit={{.HostConfig.Memory}}'
sudo docker inspect proxyhubb-edge-gateway-1 --format 'edge MemLimit={{.HostConfig.Memory}}'
sudo docker inspect proxyhubb-nats-1 --format 'nats MemLimit={{.HostConfig.Memory}}'
echo "=== redis appendonly (Cmd redacted) ==="
sudo docker inspect proxyhubb-redis-1 --format '{{json .Config.Cmd}}' | sed -E 's/--requirepass","[^"]+"/--requirepass","***"/'
echo "=== ha docs ==="
test -f /opt/proxyhubb/docs/ops/GCP_HA_LITE.md && echo HA_DOC_OK
echo "VERIFY_D_OK"
