#!/usr/bin/env bash
# Extract Host-A roll tarball and swap control-api. Keep observe / listing observe.
# Never --remove-orphans. Never slash gates.
set -euo pipefail
sudo rm -rf /tmp/host-a-control-api-roll
sudo mkdir -p /tmp/host-a-control-api-roll
sudo tar -xzf /tmp/host-a-control-api-roll.tar.gz -C /tmp/host-a-control-api-roll
sudo chown -R "$(id -u)":"$(id -g)" /tmp/host-a-control-api-roll
test -f /tmp/host-a-control-api-roll/services/control-api/internal/solana/listing_commitment.go
grep -q 'GetOraclePublicKey()' /tmp/host-a-control-api-roll/services/control-api/internal/solana/listing_commitment.go
tr -d '\015' < /tmp/host-a-control-api-roll/scripts/gcp-host-a-control-api-roll.sh > /tmp/gcp-host-a-control-api-roll.sh
tr -d '\015' < /tmp/host-a-control-api-roll/scripts/gcp-host-a-control-api-drift-probe.sh > /tmp/gcp-host-a-control-api-drift-probe.sh
tr -d '\015' < /tmp/host-a-control-api-roll/scripts/gcp-host-a-listing-commitment-shop-publish.sh > /tmp/gcp-host-a-listing-commitment-shop-publish.sh
chmod +x /tmp/gcp-host-a-control-api-roll.sh /tmp/gcp-host-a-control-api-drift-probe.sh /tmp/gcp-host-a-listing-commitment-shop-publish.sh
CONFIRM_HOST_A_ROLL=1 ROLL_STAMP=20260818 bash /tmp/gcp-host-a-control-api-roll.sh
