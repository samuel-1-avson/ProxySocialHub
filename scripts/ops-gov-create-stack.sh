#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" logs control-api --since 60m 2>/dev/null | grep -nE '14:45:3|CreateProposal|panic|runtime error|nil pointer|On-chain proposal|governance program|POST.*/v1/governance/proposals' | tail -100
echo '--- context ---'
"${COMPOSE[@]}" logs control-api --since 60m 2>/dev/null | grep -n 'POST.*/v1/governance/proposals' | tail -5
LINE=$( "${COMPOSE[@]}" logs control-api --since 60m 2>/dev/null | grep -n 'POST.*/v1/governance/proposals' | tail -1 | cut -d: -f1 || true )
if [[ -n "${LINE:-}" ]]; then
  start=$((LINE > 40 ? LINE - 40 : 1))
  "${COMPOSE[@]}" logs control-api --since 60m 2>/dev/null | sed -n "${start},$((LINE+5))p"
fi
