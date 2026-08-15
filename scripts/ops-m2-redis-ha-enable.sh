#!/usr/bin/env bash
# M2: enable Redis Sentinel + HAProxy on gcp-testnet and run kill-master chaos.
set -euo pipefail
cd /opt/proxyhubb

COMPOSE=(docker compose
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
  -f docker-compose.redis-ha.yml)

mkdir -p infra/redis
if [[ -f /tmp/docker-compose.redis-ha.yml ]]; then
  sed -i 's/\r$//' /tmp/docker-compose.redis-ha.yml
  cp -f /tmp/docker-compose.redis-ha.yml docker-compose.redis-ha.yml
fi
for f in haproxy-redis-ha.cfg.tpl sentinel.conf.tpl; do
  if [[ -f "/tmp/$f" ]]; then
    sed -i 's/\r$//' "/tmp/$f"
    cp -f "/tmp/$f" "infra/redis/$f"
  fi
done

REDIS_PASSWORD=$(grep -E '^REDIS_PASSWORD=' .env | head -1 | cut -d= -f2- | tr -d '\r')
[[ -n "$REDIS_PASSWORD" ]] || { echo 'REDIS_PASSWORD missing'; exit 1; }
if [[ "$REDIS_PASSWORD" =~ [[:space:]] ]]; then
  echo 'REDIS_PASSWORD contains whitespace — unsupported for HAProxy check'
  exit 1
fi

python3 - <<'PY'
from pathlib import Path
pwd = Path(".env").read_text().splitlines()
pw = next(l.split("=", 1)[1].strip() for l in pwd if l.startswith("REDIS_PASSWORD="))
tpl_h = Path("infra/redis/haproxy-redis-ha.cfg.tpl").read_text()
Path("infra/redis/haproxy-redis-ha.cfg").write_text(tpl_h.replace("__REDIS_PASSWORD__", pw))
tpl_s = Path("infra/redis/sentinel.conf.tpl").read_text()
cfg = tpl_s.replace("__REDIS_PASSWORD__", pw)
for i in (1, 2, 3):
    Path(f"infra/redis/sentinel-{i}.conf").write_text(cfg)
# Force REDIS_URL to HA proxy (concrete password — containers read .env directly).
lines = []
found = False
url = f"redis://:{pw}@redis-proxy:6379"
for l in Path(".env").read_text().splitlines():
    if l.startswith("REDIS_URL="):
        lines.append(f"REDIS_URL={url}")
        found = True
    else:
        lines.append(l)
if not found:
    lines.append(f"REDIS_URL={url}")
Path(".env").write_text("\n".join(lines) + "\n")
print("rendered_haproxy_and_sentinel=ok")
print("redis_url_host=redis-proxy")
PY
chmod 644 infra/redis/haproxy-redis-ha.cfg
chmod 644 infra/redis/sentinel-*.conf
chmod 600 .env

echo '=== bring up redis HA stack ==='
"${COMPOSE[@]}" up -d redis redis-replica
for i in $(seq 1 30); do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-redis-1 2>/dev/null || echo missing)
  rst=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-redis-replica-1 2>/dev/null || echo missing)
  echo "redis=$st replica=$rst"
  [[ "$st" == "healthy" && "$rst" == "healthy" ]] && break
  sleep 3
done
"${COMPOSE[@]}" up -d redis-sentinel-1 redis-sentinel-2 redis-sentinel-3 redis-proxy
sleep 3
# Ensure proxy picked up rendered cfg
"${COMPOSE[@]}" up -d --force-recreate redis-proxy
for i in $(seq 1 30); do
  if timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
    redis-cli -h redis-proxy -a "$REDIS_PASSWORD" --no-auth-warning PING 2>/dev/null | tr -d '\r' | grep -q PONG; then
    echo "proxy_ready try=$i"
    break
  fi
  echo "proxy_wait try=$i"
  sleep 2
  [[ "$i" -eq 30 ]] && { echo 'PROXY_NOT_READY'; exit 1; }
done

"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api edge-gateway
for i in $(seq 1 40); do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-control-api-1 2>/dev/null || echo missing)
  echo "api try=$i health=$st"
  [[ "$st" == "healthy" ]] && break
  sleep 3
done
[[ "$st" == "healthy" ]] || { echo 'CONTROL_API_NOT_HEALTHY'; exit 1; }

echo '=== proxy ping ==='
sudo docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis-proxy -a "$REDIS_PASSWORD" --no-auth-warning PING | tr -d '\r' | grep -q PONG

ROLE=$(sudo docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis-proxy -a "$REDIS_PASSWORD" --no-auth-warning INFO replication | tr -d '\r' | grep -E '^role:' || true)
echo "proxy_role_line=$ROLE"
echo "$ROLE" | grep -q 'role:master'

echo '=== write via proxy ==='
KEY="m2-ha-$(date -u +%Y%m%dT%H%M%SZ)"
sudo docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis-proxy -a "$REDIS_PASSWORD" --no-auth-warning SET "$KEY" "before-failover" EX 600 >/dev/null

echo '=== kill master (redis) ==='
"${COMPOSE[@]}" stop redis
echo 'waiting for sentinel failover + haproxy switch...'
switched=0
for i in $(seq 1 40); do
  # Bound redis-cli so a dead HAProxy backend cannot hang the smoke.
  if timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
    redis-cli -h redis-proxy -a "$REDIS_PASSWORD" --no-auth-warning --raw GET "$KEY" 2>/dev/null \
    | tr -d '\r' | grep -q 'before-failover'; then
    echo "attempt=$i failover_read=ok"
    switched=1
    break
  fi
  # Progress signal from sentinel
  MASTER=$(timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
    redis-cli -h redis-sentinel-1 -p 26379 SENTINEL get-master-addr-by-name mymaster 2>/dev/null | tr '\n' ' ' | tr -d '\r' || true)
  echo "attempt=$i failover_read=wait sentinel_master=${MASTER:-none}"
  sleep 2
done
test "$switched" = "1" || { echo 'FAILOVER_READ_FAILED'; exit 1; }

timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis-proxy -a "$REDIS_PASSWORD" --no-auth-warning SET "${KEY}-after" "after-failover" EX 600 >/dev/null
GOT=$(timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis-proxy -a "$REDIS_PASSWORD" --no-auth-warning --raw GET "${KEY}-after" | tr -d '\r')
echo "after_write=$GOT"
test "$GOT" = "after-failover"

echo '=== restore original redis container ==='
"${COMPOSE[@]}" start redis
sleep 8
sudo docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis-proxy -a "$REDIS_PASSWORD" --no-auth-warning PING | tr -d '\r' | grep -q PONG

st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-control-api-1 2>/dev/null || echo missing)
echo "api_health_after=$st"

echo M2_REDIS_HA_PASS
