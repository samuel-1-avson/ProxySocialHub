#!/usr/bin/env bash
# ==============================================================================
# ProxyHubb Canonical GCP CI/CD Deployment Script
#
# This script is executed on the GCP Testnet VM (`proxyhubb-testnet`) by GitHub
# Actions CI/CD or directly by operators to perform a clean zero-downtime rollout.
#
# Usage:
#   bash scripts/gcp-ci-deploy.sh [--dry-run] [--services "web docs control-api"]
#
# Disk: each build adds several GB of images and build cache to an 80 GB disk.
# Before building, the script frees space if less than DEPLOY_MIN_FREE_GB
# (default 10) is free: first build cache unused for 24h and old rollout images,
# then, only if less than DEPLOY_HARD_MIN_FREE_GB (default 6) is still free,
# ALL unused build cache (the next build is slower, but several deploys in one
# day can no longer leave nothing to free). If that is still not enough it stops,
# leaving the running stack untouched. After a verified deploy it removes build
# cache unused for DEPLOY_PRUNE_CACHE_UNUSED_FOR (default 6h) and old rollout
# images. Nothing a container uses is removed.
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
echo "[1/6] Fetching latest commits from origin/main..."
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
  echo "[2/6] Synchronizing documentation OpenAPI specs..."
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

MIN_FREE_GB=${DEPLOY_MIN_FREE_GB:-10}
HARD_MIN_FREE_GB=${DEPLOY_HARD_MIN_FREE_GB:-6}
PRUNE_CACHE_UNUSED_FOR=${DEPLOY_PRUNE_CACHE_UNUSED_FOR:-6h}

# Free GB on /, or empty when df gives no answer.
free_gb() {
  df -BG --output=avail / 2>/dev/null | tail -n 1 | tr -dc '0-9' || true
}

show_gb() {
  if [[ -n "${1:-}" ]]; then echo "$1 GB"; else echo "unknown"; fi
}

# Free disk without touching anything in use: `docker rmi` without -f refuses
# images a container (running or stopped) uses, and prune only takes unused
# images and cache. Best effort: a cleanup problem never fails the deploy.
cleanup_docker() {
  local cache_unused_for="$1" repo ref
  sudo docker image prune -f >/dev/null 2>&1 || true
  # gcp-roll-{web,explorer}-image.sh tag one image per revision; keep the newest two as rollbacks.
  for repo in proxyhubb-production/web proxyhubb-production/explorer proxyhubb-production/docs; do
    sudo docker images "$repo" --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | tail -n +3 | while read -r ref; do
      sudo docker rmi "$ref" >/dev/null 2>&1 || true
    done || true
  done
  sudo docker builder prune -f --filter "until=$cache_unused_for" >/dev/null 2>&1 || true
}

# 4. Build and roll updated microservices
TARGET_SERVICES=${SERVICES:-"db-migrate control-api web docs"}

echo "[3/6] Building and updating microservices: $TARGET_SERVICES..."
FREE_BEFORE=$(free_gb)
echo "Free disk: $(show_gb "$FREE_BEFORE")"
if [[ "$DRY_RUN" == "false" ]]; then
  if [[ -n "$FREE_BEFORE" ]] && (( FREE_BEFORE < MIN_FREE_GB )); then
    echo "Less than ${MIN_FREE_GB} GB free: removing build cache unused for 24h and old rollout images first..."
    cleanup_docker 24h
    FREE_BEFORE=$(free_gb)
    echo "Free disk after cleanup: $(show_gb "$FREE_BEFORE")"
  fi
  if [[ -n "$FREE_BEFORE" ]] && (( FREE_BEFORE < HARD_MIN_FREE_GB )); then
    # Cache newer than 24h (several deploys in one day) survives the cleanup above. A build needs
    # space more than it needs a warm cache, so as a last resort drop all unused build cache.
    echo "Only $(show_gb "$FREE_BEFORE") free: removing ALL unused build cache (the next build will be slower)..."
    sudo docker builder prune -af >/dev/null 2>&1 || true
    FREE_BEFORE=$(free_gb)
    echo "Free disk after removing all unused build cache: $(show_gb "$FREE_BEFORE")"
  fi
  if [[ -n "$FREE_BEFORE" ]] && (( FREE_BEFORE < HARD_MIN_FREE_GB )); then
    echo "❌ Only ${FREE_BEFORE} GB free (need ${HARD_MIN_FREE_GB} GB to build). Nothing was changed; the running stack is untouched." >&2
    echo "   Free space on the VM (docker system df, /var/backups, /var/log), then deploy again." >&2
    exit 1
  fi
  "${COMPOSE[@]}" up -d --build $TARGET_SERVICES
else
  echo "[DRY-RUN] ${COMPOSE[*]} up -d --build $TARGET_SERVICES"
fi

# 5. Healthcheck verification loop
echo "[4/6] Verifying microservice health..."
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
echo "[5/6] Running local HTTP verification..."
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

# 7. Reclaim disk now that the new build is verified (a failed deploy exits
# above, so the previous images stay available to roll back to)
echo "[6/6] Freeing disk: build cache unused for ${PRUNE_CACHE_UNUSED_FOR}, old rollout images..."
if [[ "$DRY_RUN" == "false" ]]; then
  cleanup_docker "$PRUNE_CACHE_UNUSED_FOR"
  FREE_AFTER=$(free_gb)
  echo "Free disk: $(show_gb "$FREE_AFTER") (was $(show_gb "$FREE_BEFORE") before the build)"
else
  echo "[DRY-RUN] Would remove unused images and build cache unused for ${PRUNE_CACHE_UNUSED_FOR}"
fi
