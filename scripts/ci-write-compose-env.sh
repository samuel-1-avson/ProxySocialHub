#!/usr/bin/env bash
# Write ephemeral Docker Compose .env values for GitHub Actions.
# All sensitive values are generated at runtime (nothing secret-like is committed).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

cp .env.example .env

rand32() { openssl rand -hex 16; }
rand64() { openssl rand -hex 32; }

{
  echo "JWT_SECRET=$(rand64)"
  echo "GATEWAY_SHARED_SECRET=$(rand64)"
  echo "SESSION_SECRET=$(rand64)"
  echo "ENCRYPTION_KEY=$(rand64)"
  echo "TOKEN_HMAC_SECRET=$(rand64)"
  echo "POSTGRES_PASSWORD=$(rand32)"
  echo "REDIS_PASSWORD=$(rand32)"
  echo "GRAFANA_ADMIN_PASSWORD=$(rand32)"
  echo "PROVIDER_PRIVATE_KEY=$(rand64)"
  echo "PROVIDER_SIGNATURE_MODE=observe"
  if [[ -n "${CLI_DIST_VERSION:-}" ]]; then
    echo "CLI_DIST_VERSION=${CLI_DIST_VERSION}"
  fi
} >> .env

# compose mounts this path; file is gitignored — materialize from committed example
if [[ -f config/docker/control-api-explorer.env.example ]]; then
  cp config/docker/control-api-explorer.env.example config/docker/control-api-explorer.env
fi
