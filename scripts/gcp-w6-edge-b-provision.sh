#!/usr/bin/env bash
# Provision Wave 6.A second-host edge VM (distinct from proxyhubb-testnet).
# Same VPC/zone so host-B can reach host-A Redis/control-api on INTERNAL IP only.
#
# Usage:
#   ./scripts/gcp-w6-edge-b-provision.sh
#
# Does not start the edge process. After create:
#   1. Apply docker-compose.w6-host-a-private.yml on host-A
#   2. Bootstrap host-B (docker + compose) — see docs/ops/W6_SECOND_HOST_EDGE.md
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-gen-lang-client-0022105784}"
REGION="${REGION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
VM_NAME="${VM_NAME:-proxyhubb-w6-edge-b}"
IP_NAME="${IP_NAME:-proxyhubb-w6-edge-b-ip}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-small}"
HOST_A="${HOST_A:-proxyhubb-testnet}"

echo "=================================================================="
echo "W6.A provision $VM_NAME ($MACHINE_TYPE) in $PROJECT_ID $ZONE"
echo "=================================================================="

gcloud services enable compute.googleapis.com --project="$PROJECT_ID"

if ! gcloud compute addresses describe "$IP_NAME" --region="$REGION" --project="$PROJECT_ID" &>/dev/null; then
  gcloud compute addresses create "$IP_NAME" --region="$REGION" --project="$PROJECT_ID"
fi
STATIC_IP=$(gcloud compute addresses describe "$IP_NAME" --region="$REGION" --project="$PROJECT_ID" --format="value(address)")
echo "Host-B static IP: $STATIC_IP"

if ! gcloud compute firewall-rules describe allow-proxyhubb-w6-edge-b --project="$PROJECT_ID" &>/dev/null; then
  gcloud compute firewall-rules create allow-proxyhubb-w6-edge-b \
    --project="$PROJECT_ID" \
    --target-tags=proxyhubb-w6-edge-b \
    --allow=tcp:22,tcp:8090,tcp:3128,udp:3128 \
    --description="W6.A host-B SSH + buyer CONNECT + provider tunnel"
fi

# Private control-plane: Redis + control-api from host-B tag → host-A tag only.
if ! gcloud compute firewall-rules describe allow-proxyhubb-w6-private-cp --project="$PROJECT_ID" &>/dev/null; then
  gcloud compute firewall-rules create allow-proxyhubb-w6-private-cp \
    --project="$PROJECT_ID" \
    --source-tags=proxyhubb-w6-edge-b \
    --target-tags=proxyhubb-testnet \
    --allow=tcp:8080,tcp:6379 \
    --description="W6.A host-B → host-A control-api + Redis (do not use 0.0.0.0 public)"
fi

if ! gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" &>/dev/null; then
  gcloud compute instances create "$VM_NAME" \
    --project="$PROJECT_ID" \
    --zone="$ZONE" \
    --machine-type="$MACHINE_TYPE" \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud \
    --boot-disk-size=30GB \
    --boot-disk-type=pd-balanced \
    --address="$STATIC_IP" \
    --tags=proxyhubb-w6-edge-b \
    --metadata=startup-script='#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y docker.io docker-compose-v2 curl
usermod -aG docker ubuntu || true
systemctl enable --now docker
'
fi

HOST_A_INTERNAL=$(gcloud compute instances describe "$HOST_A" --zone="$ZONE" --project="$PROJECT_ID" --format="value(networkInterfaces[0].networkIP)")
HOST_B_INTERNAL=$(gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" --format="value(networkInterfaces[0].networkIP)")
HOST_B_EXTERNAL=$(gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" --format="value(networkInterfaces[0].accessConfigs[0].natIP)")

echo "=================================================================="
echo "W6.A VM ready"
echo "Host-A internal: $HOST_A_INTERNAL"
echo "Host-B internal: $HOST_B_INTERNAL"
echo "Host-B public:   $HOST_B_EXTERNAL"
echo ""
echo "On host-A .env / compose:"
echo "  HOST_A_INTERNAL_IP=$HOST_A_INTERNAL"
echo "  GATEWAY_OP_A_HOST_ID=gce-proxyhubb-testnet"
echo "  GATEWAY_OP_B_HOST_ID=gce-w6-operator-b"
echo "  GATEWAY_OP_B_TUNNEL=${HOST_B_EXTERNAL}:3128"
echo "  GATEWAY_OP_B_BUYER_URL=http://${HOST_B_EXTERNAL}:8090"
echo "  GATEWAY_OP_B_HEALTH_URL=http://${HOST_B_EXTERNAL}:8090/health"
echo "  GATEWAY_OP_A_PEER_URLS=edge-b@http://${HOST_B_INTERNAL}:8090"
echo "=================================================================="
