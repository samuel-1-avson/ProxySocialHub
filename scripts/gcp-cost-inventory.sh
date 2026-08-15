#!/usr/bin/env bash
# Inventory billable GCP resources across the open billing account.
# Usage: ./scripts/gcp-cost-inventory.sh
set -euo pipefail

BILLING_ACCOUNT="${BILLING_ACCOUNT:-01F1BE-3588EA-938035}"
PROJECTS=(
  gen-lang-client-0022105784
  fiffi-500411
  gen-lang-client-0627244320
  arcade-7f03c
  gen-lang-client-0098858574
)

echo "=== Billing projects ==="
gcloud billing projects list --billing-account="$BILLING_ACCOUNT" \
  --format="table(projectId,billingEnabled)"

echo ""
echo "=== Budgets ==="
gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" \
  --format="table(displayName,amount.specifiedAmount.units,budgetFilter.projects)"

for p in "${PROJECTS[@]}"; do
  echo ""
  echo "########## PROJECT: $p ##########"

  echo "--- Compute Engine ---"
  if gcloud services list --enabled --project="$p" --filter="config.name=compute.googleapis.com" --format="value(config.name)" 2>/dev/null | grep -q compute; then
    gcloud compute instances list --project="$p" \
      --format="table(name,zone,machineType.basename(),status,disks[0].diskSizeGb)" 2>/dev/null || true
  else
    echo "(Compute API disabled)"
  fi

  echo "--- Cloud Run ---"
  if gcloud services list --enabled --project="$p" --filter="config.name=run.googleapis.com" --format="value(config.name)" 2>/dev/null | grep -q run; then
    gcloud run services list --project="$p" \
      --format="table(metadata.name,region,status.url)" 2>/dev/null || true
  else
    echo "(Cloud Run API disabled)"
  fi

  echo "--- Memorystore Redis (us-central1) ---"
  if gcloud services list --enabled --project="$p" --filter="config.name=redis.googleapis.com" --format="value(config.name)" 2>/dev/null | grep -q redis; then
    gcloud redis instances list --project="$p" --region=us-central1 \
      --format="table(name,tier,memorySizeGb,state)" 2>/dev/null || true
  else
    echo "(Redis API disabled)"
  fi

  echo "--- Cloud SQL ---"
  if gcloud services list --enabled --project="$p" --filter="config.name=sqladmin.googleapis.com" --format="value(config.name)" 2>/dev/null | grep -q sqladmin; then
    gcloud sql instances list --project="$p" \
      --format="table(name,databaseVersion,tier,region,state)" 2>/dev/null || true
  else
    echo "(Cloud SQL API disabled)"
  fi
done

echo ""
echo "Done. ProxyHubb keep-list: proxyhubb-testnet (e2-standard-4) in gen-lang-client-0022105784."
echo "Review other VMs / Cloud Run before delete. Prefer: stop → verify → delete."
