#!/usr/bin/env bash
# Replace docker bind-mount directory/junk at infra/oracle-keypair.json with example placeholder.
# Real oracle signing on gcp-testnet is Cloud KMS (SOLANA_ORACLE_KEYPAIR empty).
set -euo pipefail
cd /opt/proxyhubb
TARGET=infra/oracle-keypair.json
if [[ -d "$TARGET" ]]; then
  rm -rf "$TARGET"
fi
if [[ -f "$TARGET" ]]; then
  if ! python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert isinstance(d,list) and len(d)==64' "$TARGET" 2>/dev/null; then
    echo "replacing non-keypair junk at $TARGET"
    cp -f infra/oracle-keypair.json.example "$TARGET"
    chmod 644 "$TARGET"
  else
    echo "usable keypair file already present"
  fi
else
  cp -f infra/oracle-keypair.json.example "$TARGET"
  chmod 644 "$TARGET"
  echo "placed example placeholder at $TARGET"
fi
ls -la "$TARGET"
echo ORACLE_PLACEHOLDER_DONE
