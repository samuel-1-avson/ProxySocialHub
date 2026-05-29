#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${1:-docker-compose.dev.yml}"
NO_CACHE="${NO_CACHE:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env && -f .env.docker.example ]]; then
  cp .env.docker.example .env
  echo "Created .env from .env.docker.example"
fi

BUILD=(compose -f "$COMPOSE_FILE" build)
[[ -n "$NO_CACHE" ]] && BUILD+=(--no-cache)
BUILD+=(db-migrate control-api web)

echo "docker ${BUILD[*]}"
docker "${BUILD[@]}"

echo "Done. Start: docker compose -f $COMPOSE_FILE up -d"
