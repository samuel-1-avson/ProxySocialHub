#!/usr/bin/env bash
# Sync local cli-dist/<version>/ artifacts onto a GCE (or any SSH) host that mounts
# ./cli-dist into control-api, then restart control-api so SeedCLIDownloads re-indexes.
#
# Usage:
#   CLI_DIST_VERSION=1.0.0 SSH_HOST=user@vm ./scripts/publish-cli-dist.sh
#   CLI_DIST_VERSION=1.0.0 SSH_HOST=user@vm REMOTE_DIR=/opt/proxyhubb ./scripts/publish-cli-dist.sh
#
# Prerequisites:
#   - Local artifacts already built (rebuild-cli.ps1 and/or scripts/build-cli-dist.sh --all)
#   - SSH access to the host that runs docker compose with cli-dist mounted

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${CLI_DIST_VERSION:-1.0.0}"
SSH_HOST="${SSH_HOST:?Set SSH_HOST (e.g. user@proxyhubb-vm)}"
REMOTE_DIR="${REMOTE_DIR:-/opt/proxyhubb}"
LOCAL_DIR="$REPO_ROOT/cli-dist/$VERSION"
REMOTE_CLI_DIR="$REMOTE_DIR/cli-dist/$VERSION"
SSH_OPTS="${SSH_OPTS:--o StrictHostKeyChecking=accept-new}"

if [[ ! -d "$LOCAL_DIR" ]]; then
  echo "Missing local dist: $LOCAL_DIR" >&2
  echo "Build first: ./scripts/build-cli-dist.sh  and/or  .\\rebuild-cli.ps1" >&2
  exit 1
fi

count="$(find "$LOCAL_DIR" -type f | wc -l | tr -d ' ')"
if [[ "$count" -lt 1 ]]; then
  echo "No artifacts in $LOCAL_DIR" >&2
  exit 1
fi

echo "Publishing $count artifact(s) from $LOCAL_DIR -> ${SSH_HOST}:${REMOTE_CLI_DIR}"
ssh $SSH_OPTS "$SSH_HOST" "mkdir -p '$REMOTE_CLI_DIR'"
# shellcheck disable=SC2086
rsync -avz --progress -e "ssh $SSH_OPTS" "$LOCAL_DIR/" "${SSH_HOST}:${REMOTE_CLI_DIR}/"

echo "Restarting control-api so SeedCLIDownloads re-indexes..."
ssh $SSH_OPTS "$SSH_HOST" "cd '$REMOTE_DIR' && docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml -f docker-compose.gcp-images.yml restart control-api"

echo "Smoke-check (optional API base via API_BASE)..."
API_BASE="${API_BASE:-}"
if [[ -n "$API_BASE" ]]; then
  chmod +x "$REPO_ROOT/scripts/verify-cli-download.sh"
  for pair in "linux amd64" "windows amd64"; do
    set -- $pair
    "$REPO_ROOT/scripts/verify-cli-download.sh" --api-base "$API_BASE" --platform "$1" --arch "$2" || true
  done
fi

echo "Done. Confirm dashboard → Provider → CLI & download shows Windows/macOS when published."
