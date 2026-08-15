#!/usr/bin/env bash
# Recreate sentinels with fixed config (no resolve-hostnames) then run chaos.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
  -f docker-compose.redis-ha.yml)

if [[ -f /tmp/sentinel.conf.tpl ]]; then
  sed -i 's/\r$//' /tmp/sentinel.conf.tpl
  cp -f /tmp/sentinel.conf.tpl infra/redis/sentinel.conf.tpl
fi
if [[ -f /tmp/docker-compose.redis-ha.yml ]]; then
  sed -i 's/\r$//' /tmp/docker-compose.redis-ha.yml
  cp -f /tmp/docker-compose.redis-ha.yml docker-compose.redis-ha.yml
fi
if [[ -f /tmp/ops-m2-redis-ha-chaos.sh ]]; then
  sed -i 's/\r$//' /tmp/ops-m2-redis-ha-chaos.sh
  cp -f /tmp/ops-m2-redis-ha-chaos.sh scripts/ops-m2-redis-ha-chaos.sh
fi
if [[ -f /tmp/haproxy-redis-ha.cfg.tpl ]]; then
  sed -i 's/\r$//' /tmp/haproxy-redis-ha.cfg.tpl
  cp -f /tmp/haproxy-redis-ha.cfg.tpl infra/redis/haproxy-redis-ha.cfg.tpl
fi

python3 - <<'PY'
from pathlib import Path
pw = next(l.split("=", 1)[1].strip() for l in Path(".env").read_text().splitlines() if l.startswith("REDIS_PASSWORD="))
tpl = Path("infra/redis/sentinel.conf.tpl").read_text()
cfg = tpl.replace("__REDIS_PASSWORD__", pw)
for i in (1, 2, 3):
    Path(f"infra/redis/sentinel-{i}.conf").write_text(cfg)
tpl_h = Path("infra/redis/haproxy-redis-ha.cfg.tpl").read_text()
Path("infra/redis/haproxy-redis-ha.cfg").write_text(tpl_h.replace("__REDIS_PASSWORD__", pw))
print("sentinel_cfg_rendered")
PY
chmod 644 infra/redis/sentinel-*.conf infra/redis/haproxy-redis-ha.cfg

"${COMPOSE[@]}" up -d redis
sleep 3
"${COMPOSE[@]}" up -d --force-recreate redis-sentinel-1 redis-sentinel-2 redis-sentinel-3 redis-proxy
for i in $(seq 1 30); do
  if timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
    redis-cli -h redis-sentinel-1 -p 26379 PING 2>/dev/null | tr -d '\r' | grep -q PONG; then
    echo "sentinel_ready try=$i"
    break
  fi
  echo "sentinel_wait try=$i"
  sleep 2
  [[ "$i" -eq 30 ]] && { echo 'SENTINEL_NOT_READY'; exit 1; }
done
bash scripts/ops-m2-redis-ha-chaos.sh
