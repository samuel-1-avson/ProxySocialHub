#!/usr/bin/env bash
# Deploy Sprint D HA lite to GCP testnet and verify NATS volume + backups.
set -euo pipefail
TAR="${1:?usage: $0 /tmp/sprint-d-ha.tar.gz}"
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DOCKER="${DOCKER:-docker}"
cd "$PROJECT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Extract $TAR"
tar -xzf "$TAR" -C "$PROJECT_DIR"
find "$PROJECT_DIR/scripts" "$PROJECT_DIR/docs" "$PROJECT_DIR" -maxdepth 2 \
  -type f \( -name '*.sh' -o -name '*.yml' -o -name '*.md' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true
chmod +x "$PROJECT_DIR/scripts/"gcp-*.sh "$PROJECT_DIR/scripts/_tmp-"*.sh 2>/dev/null || true

COMPOSE=("$DOCKER" compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== recreate nats with durable volume (JetStream store) ==="
# First recreate creates empty nats_data if none existed — streams re-init (expected once).
"${COMPOSE[@]}" up -d --no-deps --force-recreate nats
sleep 3
"${COMPOSE[@]}" ps nats
VOL=$("$DOCKER" volume ls -q | grep -E 'nats_data$' | head -1 || true)
echo "nats_volume=${VOL:-none}"
[[ -n "$VOL" ]] || { echo "FAIL: nats_data volume missing"; exit 1; }

MARKER="sprint-d-ha-$(date -u +%Y%m%dT%H%M%SZ)"
echo "=== write persistence marker into volume: $MARKER ==="
"${COMPOSE[@]}" exec -T nats sh -c "echo '$MARKER' > /data/.ha_lite_marker"
BEFORE=$("${COMPOSE[@]}" exec -T nats cat /data/.ha_lite_marker | tr -d '\r\n')
[[ "$BEFORE" == "$MARKER" ]] || { echo "FAIL: could not write marker"; exit 1; }
curl -fsS --max-time 5 http://127.0.0.1:8222/varz >/tmp/varz-before.json || true

echo "=== force-recreate nats; marker must survive ==="
"${COMPOSE[@]}" up -d --no-deps --force-recreate nats
sleep 4
AFTER=$("${COMPOSE[@]}" exec -T nats cat /data/.ha_lite_marker | tr -d '\r\n')
curl -fsS --max-time 5 http://127.0.0.1:8222/varz >/tmp/varz-after.json || true
[[ "$AFTER" == "$MARKER" ]] || { echo "FAIL: marker lost after recreate (before=$BEFORE after=$AFTER)"; exit 1; }
echo "NATS_PERSIST_OK marker=$AFTER"

echo "=== apply resource limits (recreate api/edge/web lightly) ==="
"${COMPOSE[@]}" up -d --no-deps control-api edge-gateway web postgres redis
sleep 5

echo "=== install HA lite cron (idempotent) ==="
if [[ -f "$PROJECT_DIR/.env" ]]; then
  BUCKET="$(grep -E '^GCS_BACKUP_BUCKET=' "$PROJECT_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
else
  BUCKET=""
fi
GCS_BACKUP_BUCKET="${BUCKET}" bash "$PROJECT_DIR/scripts/gcp-ha-lite-install.sh" || true

echo "=== backup verify (no drill unless dumps exist) ==="
bash "$PROJECT_DIR/scripts/gcp-postgres-backup-verify.sh" || {
  echo "WARN: backup verify returned non-zero (may need first dump)"
}

echo "=== redis backup once ==="
bash "$PROJECT_DIR/scripts/gcp-redis-backup.sh" || echo "WARN: redis backup soft-fail"

echo "=== health ==="
curl -fsS --max-time 10 -o /dev/null -w "api=%{http_code}\n" http://127.0.0.1:18080/health || \
  curl -fsS --max-time 10 -o /dev/null -w "api8080=%{http_code}\n" http://127.0.0.1:8080/health

echo "DONE sprint-d ha-lite deploy"
