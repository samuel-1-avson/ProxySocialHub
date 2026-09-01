#!/usr/bin/env bash
# ==============================================================================
# ProxyHubb Canonical GCP CI/CD Deployment Script
#
# This script is executed on the GCP Testnet VM (`proxyhubb-testnet`) by GitHub
# Actions CI/CD or directly by operators to perform a clean zero-downtime rollout.
#
# Usage:
#   bash scripts/gcp-ci-deploy.sh [--dry-run] [--services "web docs control-api"]
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$PROJECT_DIR"

DRY_RUN=false
SERVICES=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --services)
      SERVICES="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

echo "============================================================"
echo "🚀 Starting ProxyHubb Automated Deployment"
echo "🕒 Timestamp : $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "📂 Directory : $PROJECT_DIR"
echo "⚙️  Dry Run   : $DRY_RUN"
echo "============================================================"

# 1. Pull latest code from main
echo "[1/5] Fetching latest commits from origin/main..."
if [[ "$DRY_RUN" == "false" ]]; then
  git fetch origin main
  git reset --hard origin/main
  CURRENT_COMMIT=$(git rev-parse --short HEAD)
  echo "Current commit: $CURRENT_COMMIT ($(git log -1 --pretty=%B | head -n 1))"
else
  echo "[DRY-RUN] Skipped git reset --hard"
fi

# 2. Synchronize Docs OpenAPI specifications if helper exists
if [[ -f "$PROJECT_DIR/scripts/sync-docs-openapi.sh" ]]; then
  echo "[2/5] Synchronizing documentation OpenAPI specs..."
  bash "$PROJECT_DIR/scripts/sync-docs-openapi.sh" || true
fi

# 3. Define Docker Compose stack files
COMPOSE=(
  sudo docker compose
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
  -f docker-compose.j2-multipod.yml
)

# 4. Build and roll updated microservices
TARGET_SERVICES=${SERVICES:-"db-migrate control-api web docs"}

echo "[3/5] Building and updating microservices: $TARGET_SERVICES..."
if [[ "$DRY_RUN" == "false" ]]; then
  "${COMPOSE[@]}" up -d --build $TARGET_SERVICES
else
  echo "[DRY-RUN] ${COMPOSE[*]} up -d --build $TARGET_SERVICES"
fi

# 5. Healthcheck verification loop
echo "[4/5] Verifying microservice health..."
if [[ "$DRY_RUN" == "false" ]]; then
  MAX_ATTEMPTS=30
  HEALTHY=false
  for i in $(seq 1 $MAX_ATTEMPTS); do
    STATUS_WEB=$("${COMPOSE[@]}" ps web --format '{{.Status}}' 2>/dev/null || true)
    STATUS_DOCS=$("${COMPOSE[@]}" ps docs --format '{{.Status}}' 2>/dev/null || true)
    STATUS_API=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' 2>/dev/null || true)

    echo "Attempt $i/$MAX_ATTEMPTS | web: ${STATUS_WEB:-down} | docs: ${STATUS_DOCS:-down} | api: ${STATUS_API:-down}"

    if echo "$STATUS_WEB" | grep -qi "healthy" && \
       echo "$STATUS_DOCS" | grep -qi "healthy" && \
       echo "$STATUS_API" | grep -qi "healthy"; then
      HEALTHY=true
      echo "✅ All microservices are healthy!"
      break
    fi
    sleep 5
  done

  if [[ "$HEALTHY" == "false" ]]; then
    echo "⚠️ Warning: Some services have not reported healthy within timeout."
    "${COMPOSE[@]}" ps
  fi
fi

# 6. Local HTTP Smoke Checks
echo "[5/5] Running local HTTP verification..."
if [[ "$DRY_RUN" == "false" ]]; then
  CODE_WEB=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000/whitepaper" || echo "failed")
  CODE_DOCS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3010/docs/whitepaper" || echo "failed")
  CODE_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:8080/health" || echo "failed")

  echo "Local /whitepaper       HTTP Status: $CODE_WEB"
  echo "Local /docs/whitepaper  HTTP Status: $CODE_DOCS"
  echo "Local /health (API)     HTTP Status: $CODE_HEALTH"

  if [[ "$CODE_WEB" == "200" && "$CODE_DOCS" == "200" ]]; then
    echo "============================================================"
    echo "🎉 Deployment successfully completed and verified!"
    echo "============================================================"
  else
    echo "⚠️ Smoke tests returned non-200 status. Review container logs."
    exit 1
  fi
fi
