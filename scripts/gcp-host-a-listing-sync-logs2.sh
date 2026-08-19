#!/usr/bin/env bash
set -euo pipefail
C=proxyhubb-control-api-1
sudo docker exec "$C" printenv | awk -F= '/^SOLANA_ORACLE|^SOLANA_RPC_ENDPOINT|^SOLANA_PROGRAM_ID|^PROXYHUB_LISTING/{print $1"=set"}'
echo ---mounts---
sudo docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' "$C" | tr ' ' '\n' | grep -iE 'oracle|secret|keypair' || echo no_oracle_mount
echo ---logcount---
sudo docker logs "$C" --since 2h 2>&1 | wc -l
echo ---grep---
sudo docker logs "$C" --since 2h 2>&1 | grep -i commitment | tail -20 || echo no_commitment_lines
echo ---sample---
sudo docker logs "$C" --since 2h 2>&1 | tail -5
