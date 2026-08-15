#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
  -f docker-compose.redis-ha.yml)

for f in docker-compose.redis-ha.yml sentinel.conf.tpl haproxy-redis-ha.cfg.tpl ops-m2-redis-ha-chaos.sh; do
  if [[ -f "/tmp/$f" ]]; then
    sed -i 's/\r$//' "/tmp/$f"
  fi
done
[[ -f /tmp/docker-compose.redis-ha.yml ]] && cp -f /tmp/docker-compose.redis-ha.yml docker-compose.redis-ha.yml
[[ -f /tmp/sentinel.conf.tpl ]] && cp -f /tmp/sentinel.conf.tpl infra/redis/sentinel.conf.tpl
[[ -f /tmp/haproxy-redis-ha.cfg.tpl ]] && cp -f /tmp/haproxy-redis-ha.cfg.tpl infra/redis/haproxy-redis-ha.cfg.tpl
[[ -f /tmp/ops-m2-redis-ha-chaos.sh ]] && cp -f /tmp/ops-m2-redis-ha-chaos.sh scripts/ops-m2-redis-ha-chaos.sh

python3 - <<'PY'
from pathlib import Path
pw = next(l.split("=", 1)[1].strip() for l in Path(".env").read_text().splitlines() if l.startswith("REDIS_PASSWORD="))
tpl = Path("infra/redis/sentinel.conf.tpl").read_text()
cfg = tpl.replace("__REDIS_PASSWORD__", pw)
for i in (1, 2, 3):
    Path(f"infra/redis/sentinel-{i}.conf").write_text(cfg)
tpl_h = Path("infra/redis/haproxy-redis-ha.cfg.tpl").read_text()
Path("infra/redis/haproxy-redis-ha.cfg").write_text(tpl_h.replace("__REDIS_PASSWORD__", pw))
print("cfg_ok")
PY
chmod 644 infra/redis/sentinel-*.conf infra/redis/haproxy-redis-ha.cfg

docker update --restart=unless-stopped proxyhubb-redis-1 >/dev/null 2>&1 || true
"${COMPOSE[@]}" up -d --force-recreate redis
sleep 5
"${COMPOSE[@]}" up -d --force-recreate redis-replica
sleep 5
"${COMPOSE[@]}" up -d --force-recreate redis-sentinel-1 redis-sentinel-2 redis-sentinel-3 redis-proxy
for i in $(seq 1 40); do
  ok=1
  timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine redis-cli -h redis-sentinel-1 -p 26379 PING 2>/dev/null | grep -q PONG || ok=0
  timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine redis-cli -h redis-proxy -a "$(grep ^REDIS_PASSWORD= .env | cut -d= -f2- | tr -d '\r')" --no-auth-warning PING 2>/dev/null | grep -q PONG || ok=0
  echo "ready_try=$i ok=$ok"
  [[ "$ok" == "1" ]] && break
  sleep 3
done
[[ "$ok" == "1" ]] || { echo 'STACK_NOT_READY'; exit 1; }

"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api edge-gateway
sleep 5
bash scripts/ops-m2-redis-ha-chaos.sh
