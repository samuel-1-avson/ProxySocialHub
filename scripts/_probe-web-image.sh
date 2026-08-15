#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
echo "=== .env image tags ==="
grep -E '^(IMAGE_TAG|GHCR_OWNER)=' .env | sed 's/\r$//' || true
echo "=== web container ==="
docker inspect proxyhubb-web-1 --format 'image={{.Config.Image}} created={{.Created}}' 2>/dev/null || echo missing
echo "=== local web images ==="
docker images --format '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}' | grep -iE 'web|ghcr' | head -30
echo "=== ghcr login ==="
docker login ghcr.io --get-login 2>/dev/null || echo GHCR_LOGIN=no
