#!/usr/bin/env bash
set -euo pipefail
C=proxyhubb-control-api-1
if sudo docker exec "$C" printenv SOLANA_ORACLE_KEYPAIR >/dev/null 2>&1; then
  echo ORACLE_ENV=present
else
  echo ORACLE_ENV=missing
fi
p=$(sudo docker exec "$C" printenv SOLANA_ORACLE_KEYPAIR 2>/dev/null || true)
if [[ -n "$p" ]]; then
  if sudo docker exec "$C" test -f "$p"; then
    echo ORACLE_FILE=exists
  else
    echo ORACLE_FILE=path_set_missing_file
  fi
else
  echo ORACLE_FILE=no_path
fi
echo ---logs---
sudo docker logs "$C" --tail 800 2>&1 | grep -iE 'listing commitment|oracle unavailable' | tail -40 || true
