#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
echo "=== oracle keypair paths ==="
ls -la infra/oracle-keypair.json 2>&1 || true
ls -lad infra/oracle-keypair.json 2>&1 || true
file infra/oracle-keypair.json 2>&1 || true
# common alternates
ls -la infra/*oracle* 2>&1 | head -20 || true
ls -la /opt/proxyhubb/secrets 2>&1 | head || true
grep -E 'ORACLE|KEYPAIR' .env | sed 's/=.*/=***/' || true
# docker volume probe from prior smoke
ls -la /tmp/escrow-buy-smoke 2>&1 | head || true
# find a json keypair that looks like solana
find /opt/proxyhubb -maxdepth 3 -name '*oracle*.json' 2>/dev/null | head
find /opt/proxyhubb -maxdepth 3 -name '*keypair*.json' 2>/dev/null | head
