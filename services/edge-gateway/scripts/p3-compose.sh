#!/usr/bin/env bash
# Shared helpers for P3 bash scripts. Source from other p3-*.sh files.
P3_COMPOSE_PROJECT="${P3_COMPOSE_PROJECT:-edge-p3}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
P3_COMPOSE_FILE="${P3_COMPOSE_FILE:-${SCRIPT_DIR}/../docker-compose.p3-multipod.yml}"

p3_compose() {
  docker compose -p "$P3_COMPOSE_PROJECT" -f "$P3_COMPOSE_FILE" "$@"
}

p3_redis_id() {
  if [[ -n "${P3_REDIS_CONTAINER:-}" ]]; then
    echo "$P3_REDIS_CONTAINER"
    return
  fi
  p3_compose ps -q redis | head -n1
}

p3_redis_cli() {
  docker exec "$(p3_redis_id)" redis-cli "$@"
}

# Avoid shell quoting issues when SET value is JSON.
p3_redis_set_json() {
  local key=$1 value=$2 ex=${3:-120}
  printf '%s' "$value" | docker exec -i "$(p3_redis_id)" redis-cli -x SET "$key" >/dev/null
  if [[ "$ex" -gt 0 ]]; then
    p3_redis_cli EXPIRE "$key" "$ex" >/dev/null
  fi
}

remove_legacy_p3_containers() {
  for name in proxyhubb-p3-redis proxyhubb-p3-edge-a proxyhubb-p3-edge-b; do
    docker rm -f "$name" 2>/dev/null || true
  done
}
