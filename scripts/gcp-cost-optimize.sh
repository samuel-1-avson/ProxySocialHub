#!/usr/bin/env bash
# Safe cost-optimization helpers for the open billing account.
#
# Does NOT delete Cloud Run / Arcade / Arena without CONFIRM=yes.
# Usage:
#   ./scripts/gcp-cost-optimize.sh inventory
#   ./scripts/gcp-cost-optimize.sh stop-non-proxyhubb-vms   # interactive list only unless APPLY=1
#   CONFIRM=yes ./scripts/gcp-cost-optimize.sh scale-run-min-zero PROJECT_ID
#
set -euo pipefail

BILLING_ACCOUNT="${BILLING_ACCOUNT:-01F1BE-3588EA-938035}"
PROXYHUBB_PROJECT="${PROXYHUBB_PROJECT:-gen-lang-client-0022105784}"
PROXYHUBB_VM="${PROXYHUBB_VM:-proxyhubb-testnet}"

cmd="${1:-inventory}"

inventory() {
  exec "$(dirname "$0")/gcp-cost-inventory.sh"
}

list_extra_vms() {
  echo "VMs that are NOT ${PROXYHUBB_VM} (candidates to stop if unused):"
  gcloud compute instances list --project="$PROXYHUBB_PROJECT" \
    --filter="name!=${PROXYHUBB_VM}" \
    --format="table(name,zone,machineType.basename(),status,creationTimestamp)"
  echo ""
  echo "Also check other billing projects (fiffi, arcade, gen-lang-*)."
}

scale_run_min_zero() {
  local project="${2:-}"
  if [[ -z "$project" ]]; then
    echo "Usage: CONFIRM=yes $0 scale-run-min-zero PROJECT_ID" >&2
    exit 1
  fi
  if [[ "${CONFIRM:-}" != "yes" ]]; then
    echo "Dry run. Services in $project:"
    gcloud run services list --project="$project" --format="table(metadata.name,region)"
    echo "Re-run with CONFIRM=yes to set min instances = 0 on each."
    exit 0
  fi
  while read -r name region; do
    [[ -z "${name:-}" ]] && continue
    echo "Updating $name ($region) minScale=0 ..."
    gcloud run services update "$name" --project="$project" --region="$region" \
      --min-instances=0 --quiet || true
  done < <(gcloud run services list --project="$project" --format="value(metadata.name,region)")
}

case "$cmd" in
  inventory) inventory ;;
  list-extra-vms) list_extra_vms ;;
  scale-run-min-zero) scale_run_min_zero "$@" ;;
  *)
    echo "Commands: inventory | list-extra-vms | scale-run-min-zero PROJECT_ID" >&2
    exit 1
    ;;
esac
