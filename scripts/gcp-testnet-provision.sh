#!/usr/bin/env bash
# Provision GCP Compute Engine instance and firewall rules for ProxyHubb Phase A Testnet.
#
# Requirements: gcloud CLI authenticated with project owner or compute admin permissions.
# Usage: ./scripts/gcp-testnet-provision.sh [PROJECT_ID] [REGION] [ZONE]

set -euo pipefail

PROJECT_ID="${1:-$(gcloud config get-value project 2>/dev/null || echo "")}"
REGION="${2:-us-central1}"
ZONE="${3:-us-central1-a}"
VM_NAME="proxyhubb-testnet"
IP_NAME="proxyhubb-testnet-ip"
MACHINE_TYPE="${MACHINE_TYPE:-e2-standard-4}"

if [ -z "$PROJECT_ID" ]; then
  echo "Error: PROJECT_ID is required as argument 1 or gcloud default project." >&2
  exit 1
fi

echo "=================================================================="
echo "Provisioning ProxyHubb Phase A Testnet VM on GCP"
echo "Project: $PROJECT_ID | Region: $REGION | Zone: $ZONE"
echo "Machine Type: $MACHINE_TYPE"
echo "=================================================================="

# 1. Enable Compute Engine API
echo "[1/4] Enabling Compute Engine API..."
gcloud services enable compute.googleapis.com --project="$PROJECT_ID"

# 2. Reserve Static External IP
echo "[2/4] Reserving static external IP address..."
if ! gcloud compute addresses describe "$IP_NAME" --region="$REGION" --project="$PROJECT_ID" &>/dev/null; then
  gcloud compute addresses create "$IP_NAME" --region="$REGION" --project="$PROJECT_ID"
fi

STATIC_IP=$(gcloud compute addresses describe "$IP_NAME" --region="$REGION" --project="$PROJECT_ID" --format="value(address)")
echo "Static External IP: $STATIC_IP"

# 3. Create Firewall Rules
echo "[3/4] Creating firewall rules..."
if ! gcloud compute firewall-rules describe allow-proxyhubb-testnet --project="$PROJECT_ID" &>/dev/null; then
  gcloud compute firewall-rules create allow-proxyhubb-testnet \
    --project="$PROJECT_ID" \
    --target-tags=proxyhubb-testnet \
    --allow=tcp:22,tcp:80,tcp:443,tcp:8090,tcp:3128,udp:3128 \
    --description="Allow SSH, HTTP, HTTPS, Buyer CONNECT (8090), Provider Tunnel (3128)"
fi

# 4. Launch GCE VM Instance
echo "[4/4] Creating Compute Engine instance ($VM_NAME)..."
if ! gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" &>/dev/null; then
  gcloud compute instances create "$VM_NAME" \
    --project="$PROJECT_ID" \
    --zone="$ZONE" \
    --machine-type="$MACHINE_TYPE" \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud \
    --boot-disk-size=80GB \
    --boot-disk-type=pd-balanced \
    --address="$STATIC_IP" \
    --tags=proxyhubb-testnet
fi

echo "=================================================================="
echo "SUCCESS! GCE VM Provisioned."
echo "VM Name: $VM_NAME"
echo "External IP: $STATIC_IP"
echo ""
echo "Next Steps:"
echo "1. Set A-records in DNS pointing to $STATIC_IP for:"
echo "   - app.yourdomain.com"
echo "   - api.yourdomain.com"
echo "   - proxy.yourdomain.com"
echo ""
echo "2. SSH into the VM and run setup:"
echo "   gcloud compute ssh $VM_NAME --zone=$ZONE --project=$PROJECT_ID"
echo ""
echo "3. Provision Postgres backups (GCS + disk snapshots):"
echo "   ./scripts/gcp-testnet-provision-backups.sh $PROJECT_ID $REGION $ZONE"
echo "=================================================================="
