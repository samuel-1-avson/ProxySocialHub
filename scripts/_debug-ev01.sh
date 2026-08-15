#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
echo '=== control-api restart / health ==='
docker inspect proxyhubb-control-api-1 --format 'status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{end}} started={{.State.StartedAt}} restarts={{.RestartCount}}'
docker logs proxyhubb-control-api-1 2>&1 | tail -40

echo '=== TREASURY after publish ==='
sudo docker run --rm --network proxyhubb_backend natsio/nats-box:0.14.3 \
  nats stream info TREASURY -s nats://nats:4222
sudo docker run --rm --network proxyhubb_backend natsio/nats-box:0.14.3 \
  nats consumer info TREASURY treasury-event-consumer -s nats://nats:4222

echo '=== last stream msg ==='
sudo docker run --rm --network proxyhubb_backend natsio/nats-box:0.14.3 \
  nats stream get TREASURY -s nats://nats:4222 --last 2>&1 | head -40

echo EV01_DEBUG_DONE
