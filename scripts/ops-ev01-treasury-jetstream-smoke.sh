#!/usr/bin/env bash
# EV-01 smoke: TREASURY JetStream stream + durable consumer + publish→ack progress.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
TS=$(date -u +%Y%m%dT%H%M%SZ)
SUBJECT="proxy.treasury.v1.topup"
MARKER="ev01-smoke-${TS}"

echo "=== EV-01 inventory (${TS}) ==="
for i in $(seq 1 40); do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-control-api-1 2>/dev/null || echo missing)
  echo "api_health try=$i status=$st"
  [[ "$st" == "healthy" ]] && break
  sleep 3
done
[[ "$st" == "healthy" ]] || { echo 'CONTROL_API_NOT_HEALTHY'; exit 1; }

docker logs proxyhubb-control-api-1 2>&1 | grep -E 'Treasury Event Consumer started|initialized streams' | tail -5 || true

echo '=== stream TREASURY ==='
INFO=$(sudo docker run --rm --network proxyhubb_backend natsio/nats-box:0.14.3 \
  nats stream info TREASURY -s nats://nats:4222 2>&1)
echo "$INFO"
echo "$INFO" | grep -q 'TREASURY' || { echo 'TREASURY_STREAM_MISSING'; exit 1; }
echo "$INFO" | grep -qiE 'proxy\.treasury\.v1' || { echo 'TREASURY_SUBJECTS_MISSING'; exit 1; }

echo '=== consumer treasury-event-consumer ==='
CINFO=$(sudo docker run --rm --network proxyhubb_backend natsio/nats-box:0.14.3 \
  nats consumer info TREASURY treasury-event-consumer -s nats://nats:4222 2>&1)
echo "$CINFO"
echo "$CINFO" | grep -qi 'treasury-event-consumer' || { echo 'TREASURY_CONSUMER_MISSING'; exit 1; }

ack_floor() {
  sudo docker run --rm --network proxyhubb_backend natsio/nats-box:0.14.3 \
    nats consumer info TREASURY treasury-event-consumer -s nats://nats:4222 2>/dev/null \
    | sed -n 's/.*Acknowledgment Floor: Consumer sequence: \([0-9][0-9]*\) Stream sequence: \([0-9][0-9]*\).*/\2/p' \
    | head -1
}
stream_last() {
  sudo docker run --rm --network proxyhubb_backend natsio/nats-box:0.14.3 \
    nats stream info TREASURY -s nats://nats:4222 2>/dev/null \
    | sed -n 's/.*Last Sequence: \([0-9][0-9]*\).*/\1/p' \
    | head -1
}

BEFORE_ACK=$(ack_floor)
BEFORE_LAST=$(stream_last)
BEFORE_ACK=${BEFORE_ACK:-0}
BEFORE_LAST=${BEFORE_LAST:-0}
echo "before_ack_floor=$BEFORE_ACK before_last_seq=$BEFORE_LAST"

echo '=== publish topup event ==='
PAYLOAD=$(printf '{"type":"topup","source":"ev01_smoke","marker":"%s","amount_sol":0.0,"ts":"%s"}' "$MARKER" "$TS")
sudo docker run --rm --network proxyhubb_backend natsio/nats-box:0.14.3 \
  nats pub "$SUBJECT" "$PAYLOAD" -s nats://nats:4222
echo "published subject=$SUBJECT marker=$MARKER"

progressed=0
for i in $(seq 1 30); do
  AFTER_ACK=$(ack_floor)
  AFTER_LAST=$(stream_last)
  AFTER_ACK=${AFTER_ACK:-0}
  AFTER_LAST=${AFTER_LAST:-0}
  echo "attempt=$i ack_floor=$AFTER_ACK last_seq=$AFTER_LAST"
  if [[ "$AFTER_LAST" -gt "$BEFORE_LAST" && "$AFTER_ACK" -ge "$AFTER_LAST" ]]; then
    progressed=1
    break
  fi
  # Also accept ack floor advancing past prior publish
  if [[ "$AFTER_ACK" -gt "$BEFORE_ACK" && "$AFTER_LAST" -gt "$BEFORE_LAST" ]]; then
    # wait until floor catches last
    :
  fi
  sleep 2
done

# Final read
AFTER_ACK=$(ack_floor)
AFTER_LAST=$(stream_last)
AFTER_ACK=${AFTER_ACK:-0}
AFTER_LAST=${AFTER_LAST:-0}
echo "final_ack_floor=$AFTER_ACK final_last_seq=$AFTER_LAST"
test "$AFTER_LAST" -gt "$BEFORE_LAST" || { echo 'STREAM_DID_NOT_ACCEPT_PUBLISH'; exit 1; }
test "$AFTER_ACK" -ge "$AFTER_LAST" || { echo 'CONSUMER_ACK_LAGGING'; exit 1; }
test "$progressed" = "1" || test "$AFTER_ACK" -ge "$AFTER_LAST"

# Best-effort log marker (may miss across API restarts)
if docker logs proxyhubb-control-api-1 2>&1 | grep -F "$MARKER" | tail -3 | grep -q .; then
  echo "consumed_log=yes"
else
  echo "consumed_log=no (ack-floor progress is authoritative)"
fi

PENDING=$(sudo docker run --rm --network proxyhubb_backend natsio/nats-box:0.14.3 \
  nats consumer info TREASURY treasury-event-consumer -s nats://nats:4222 2>/dev/null \
  | sed -n 's/.*Unprocessed Messages: \([0-9][0-9]*\).*/\1/p' | head -1)
PENDING=${PENDING:-999}
echo "unprocessed=$PENDING"
test "$PENDING" -eq 0

echo EV01_TREASURY_JETSTREAM_PASS
