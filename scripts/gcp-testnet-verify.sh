#!/usr/bin/env bash
# Smoke-check GCP Phase A testnet after deploy.
# Usage: API_BASE_URL=https://api.testnet.example.com ./scripts/gcp-testnet-verify.sh

set -euo pipefail

API_BASE_URL="${API_BASE_URL:?Set API_BASE_URL}"
FRONTEND_URL="${FRONTEND_URL:-}"
GATEWAY_HOST="${EDGE_GATEWAY_BUYER_HOST:-}"
GATEWAY_PORT="${EDGE_GATEWAY_BUYER_PORT:-8090}"

echo "=== API health ==="
curl -fsS "${API_BASE_URL}/health"
echo ""

echo "=== Solana health ==="
curl -fsS "${API_BASE_URL}/v1/solana/health" | head -c 500
echo ""

if [[ -n "$FRONTEND_URL" ]]; then
  echo "=== Web (HTTP status) ==="
  curl -fsS -o /dev/null -w "%{http_code}\n" "$FRONTEND_URL"
fi

if [[ -n "$GATEWAY_HOST" ]]; then
  echo "=== Edge health (TCP ${GATEWAY_HOST}:${GATEWAY_PORT}) ==="
  curl -fsS --max-time 10 "http://${GATEWAY_HOST}:${GATEWAY_PORT}/health" || echo "WARN: edge health failed (check firewall 8090)"
fi

echo "=== CLI download HEAD ==="
curl -fsSI "${API_BASE_URL}/v1/cli/download?platform=linux&arch=amd64" | head -5

echo ""
echo "Done. Run remote provider bootstrap + two-user web buy per docs/GCP_TESTNET_PHASE_A.md"
