#!/usr/bin/env bash
# M2 chaos-only: assumes redis HA stack already up. Kill master → read/write via proxy.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
  -f docker-compose.redis-ha.yml)

REDIS_PASSWORD=$(grep -E '^REDIS_PASSWORD=' .env | head -1 | cut -d= -f2- | tr -d '\r')

wait_proxy() {
  for i in $(seq 1 30); do
    if timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
      redis-cli -h redis-proxy -a "$REDIS_PASSWORD" --no-auth-warning PING 2>/dev/null | tr -d '\r' | grep -q PONG; then
      echo "proxy_ready try=$i"
      return 0
    fi
    echo "proxy_wait try=$i"
    sleep 2
  done
  return 1
}

echo '=== wait for sentinel ==='
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

echo '=== sentinel master ==='
timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis-sentinel-1 -p 26379 SENTINEL get-master-addr-by-name mymaster

wait_proxy

KEY="m2-chaos-$(date -u +%Y%m%dT%H%M%SZ)"
timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis-proxy -a "$REDIS_PASSWORD" --no-auth-warning SET "$KEY" "before-failover" EX 600 >/dev/null
echo "wrote key=$KEY"

echo '=== stop redis master process (keep container/DNS up) ==='
docker update --restart=no proxyhubb-redis-1 >/dev/null || true
timeout 10 docker exec proxyhubb-redis-1 redis-cli -a "$REDIS_PASSWORD" --no-auth-warning SHUTDOWN NOSAVE || true
sleep 2
# Container should still be running (sleep infinity wrapper).
running=$(docker inspect -f '{{.State.Running}}' proxyhubb-redis-1 2>/dev/null || echo false)
echo "redis_container_running=$running"
[[ "$running" == "true" ]] || { echo 'REDIS_CONTAINER_EXITED_DNS_WILL_BREAK'; exit 1; }
if timeout 3 docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis -a "$REDIS_PASSWORD" --no-auth-warning PING 2>/dev/null | grep -q PONG; then
  echo 'REDIS_STILL_UP_AFTER_SHUTDOWN'
  exit 1
fi
echo 'redis_process_down=yes dns_preserved=yes'

switched=0
for i in $(seq 1 40); do
  MASTER=$(timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
    redis-cli -h redis-sentinel-1 -p 26379 SENTINEL get-master-addr-by-name mymaster 2>/dev/null | tr '\n' ':' | tr -d '\r' || true)
  VAL=$(timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
    redis-cli -h redis-proxy -a "$REDIS_PASSWORD" --no-auth-warning --raw GET "$KEY" 2>/dev/null | tr -d '\r' || true)
  echo "attempt=$i sentinel_master=$MASTER get=$VAL"
  if [[ "$VAL" == "before-failover" ]]; then
    switched=1
    break
  fi
  sleep 2
done
test "$switched" = "1" || { echo 'FAILOVER_READ_FAILED'; exit 1; }

timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis-proxy -a "$REDIS_PASSWORD" --no-auth-warning SET "${KEY}-after" "after-failover" EX 600 >/dev/null
GOT=$(timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis-proxy -a "$REDIS_PASSWORD" --no-auth-warning --raw GET "${KEY}-after" | tr -d '\r')
echo "after_write=$GOT"
test "$GOT" = "after-failover"

echo '=== restore redis ==='
docker update --restart=unless-stopped proxyhubb-redis-1 >/dev/null || true
docker restart proxyhubb-redis-1
sleep 8
wait_proxy

echo M2_REDIS_HA_PASS
