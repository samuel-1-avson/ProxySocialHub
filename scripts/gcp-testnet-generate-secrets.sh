#!/usr/bin/env bash
# Generate secrets for GCP Phase A testnet .env (run on the GCE VM).
# Usage: ./scripts/gcp-testnet-generate-secrets.sh >> .env.secrets
# Merge into .env manually; never commit output.

set -euo pipefail

gen() { openssl rand -hex 32; }

echo "# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) — merge into .env"
echo "JWT_SECRET=$(gen)"
echo "SESSION_SECRET=$(gen)"
echo "ENCRYPTION_KEY=$(gen)"
echo "TOKEN_HMAC_SECRET=$(gen)"
echo "GATEWAY_SHARED_SECRET=$(gen)"
echo "POSTGRES_PASSWORD=$(gen)"
echo "REDIS_PASSWORD=$(gen)"
echo "GRAFANA_ADMIN_PASSWORD=$(gen)"
