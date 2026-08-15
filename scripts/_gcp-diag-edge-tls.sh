#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" exec -T edge-gateway sh -c 'printenv | sort' | grep -iE 'TLS|CERT|TUNNEL|PORT|JWT' || true
"${COMPOSE[@]}" logs edge-gateway --tail 40 2>/dev/null | grep -iE 'Tunnel Server|TLS|plaintext|listening' || true
ls -la /opt/proxyhubb/certs 2>/dev/null || ls -la certs 2>/dev/null || echo no_certs_dir
echo DONE
