#!/usr/bin/env bash
# Provision GCS backup bucket + daily boot-disk snapshot schedule for Phase A.
#
# Run from a machine with gcloud (local laptop or the VM):
#   ./scripts/gcp-testnet-provision-backups.sh [PROJECT_ID] [REGION] [ZONE]
#
# Idempotent. Prints the GCS_BACKUP_BUCKET value to put in the VM .env.

set -euo pipefail

PROJECT_ID="${1:-$(gcloud config get-value project 2>/dev/null || echo "")}"
REGION="${2:-us-central1}"
ZONE="${3:-us-central1-a}"
VM_NAME="${VM_NAME:-proxyhubb-testnet}"
BUCKET="${GCS_BACKUP_BUCKET:-proxyhubb-${PROJECT_ID}-postgres-backups}"
SNAPSHOT_POLICY="${SNAPSHOT_POLICY:-proxyhubb-daily-boot-snap}"
RETENTION_DAYS="${SNAPSHOT_RETENTION_DAYS:-14}"

if [ -z "$PROJECT_ID" ]; then
  echo "Error: PROJECT_ID required (arg 1 or gcloud default project)." >&2
  exit 1
fi

echo "=================================================================="
echo "Provisioning ProxyHubb backups"
echo "Project: $PROJECT_ID | Region: $REGION | Zone: $ZONE"
echo "Bucket:  gs://${BUCKET}"
echo "Policy:  ${SNAPSHOT_POLICY} (retain ${RETENTION_DAYS}d)"
echo "=================================================================="

echo "[1/4] Enabling APIs..."
gcloud services enable compute.googleapis.com storage.googleapis.com --project="$PROJECT_ID"

echo "[2/4] Creating versioned GCS bucket (if missing)..."
if ! gcloud storage buckets describe "gs://${BUCKET}" --project="$PROJECT_ID" &>/dev/null; then
  gcloud storage buckets create "gs://${BUCKET}" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --uniform-bucket-level-access
  gcloud storage buckets update "gs://${BUCKET}" \
    --versioning \
    --project="$PROJECT_ID"
  # Nearline-ish lifecycle: delete noncurrent after 30d, live objects after 90d
  cat >/tmp/proxyhubb-backup-lifecycle.json <<'JSON'
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 90, "matchesPrefix": ["postgres/"]}
    },
    {
      "action": {"type": "Delete"},
      "condition": {"numNewerVersions": 3, "matchesPrefix": ["postgres/"]}
    }
  ]
}
JSON
  gcloud storage buckets update "gs://${BUCKET}" \
    --lifecycle-file=/tmp/proxyhubb-backup-lifecycle.json \
    --project="$PROJECT_ID" || true
else
  echo "Bucket already exists."
fi

echo "[3/4] Creating daily snapshot schedule (if missing)..."
if ! gcloud compute resource-policies describe "$SNAPSHOT_POLICY" --region="$REGION" --project="$PROJECT_ID" &>/dev/null; then
  gcloud compute resource-policies create snapshot-schedule "$SNAPSHOT_POLICY" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --max-retention-days="$RETENTION_DAYS" \
    --start-time=04:00 \
    --daily-schedule \
    --on-source-disk-delete=keep-auto-snapshots \
    --storage-location="$REGION"
else
  echo "Snapshot policy already exists."
fi

echo "[4/4] Attaching snapshot policy to VM boot disk..."
if gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" &>/dev/null; then
  DISK="$(gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" \
    --format='value(disks[0].source)' | awk -F/ '{print $NF}')"
  EXISTING="$(gcloud compute disks describe "$DISK" --zone="$ZONE" --project="$PROJECT_ID" \
    --format='value(resourcePolicies)' || true)"
  if echo "$EXISTING" | grep -q "$SNAPSHOT_POLICY"; then
    echo "Disk $DISK already has $SNAPSHOT_POLICY"
  else
    gcloud compute disks add-resource-policies "$DISK" \
      --project="$PROJECT_ID" \
      --zone="$ZONE" \
      --resource-policies="$SNAPSHOT_POLICY"
    echo "Attached $SNAPSHOT_POLICY to disk $DISK"
  fi

  # Grant the VM's service account objectAdmin on the bucket (best-effort).
  SA="$(gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" \
    --format='value(serviceAccounts[0].email)' || true)"
  if [ -n "$SA" ]; then
    echo "Granting roles/storage.objectAdmin on gs://${BUCKET} to $SA"
    gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
      --member="serviceAccount:${SA}" \
      --role="roles/storage.objectAdmin" \
      --project="$PROJECT_ID" >/dev/null || true

    echo "Ensuring VM has cloud-platform scope (required for gcloud storage from the instance)..."
    SCOPES="$(gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" \
      --format='value(serviceAccounts[0].scopes)' || true)"
    if ! echo "$SCOPES" | grep -Eq 'cloud-platform|devstorage'; then
      echo "WARN: VM scopes lack storage access ($SCOPES)."
      echo "      Stop the VM briefly and run:"
      echo "      gcloud compute instances stop $VM_NAME --zone=$ZONE --project=$PROJECT_ID"
      echo "      gcloud compute instances set-service-account $VM_NAME --zone=$ZONE --project=$PROJECT_ID \\"
      echo "        --service-account=$SA --scopes=cloud-platform"
      echo "      gcloud compute instances start $VM_NAME --zone=$ZONE --project=$PROJECT_ID"
    else
      echo "VM scopes OK for GCS."
    fi
  fi
else
  echo "WARN: VM $VM_NAME not found in $ZONE — create VM first, then re-run to attach policy." >&2
fi

echo "=================================================================="
echo "SUCCESS"
echo "Add to VM .env:"
echo "  GCS_BACKUP_BUCKET=${BUCKET}"
echo ""
echo "On the VM:"
echo "  sudo GCS_BACKUP_BUCKET=${BUCKET} ./scripts/gcp-postgres-backup-install.sh"
echo "  cd /opt/proxyhubb && sudo DOCKER='docker' ./scripts/gcp-postgres-backup.sh"
echo "  sudo ./scripts/gcp-postgres-backup-verify.sh --run-drill"
echo "=================================================================="
