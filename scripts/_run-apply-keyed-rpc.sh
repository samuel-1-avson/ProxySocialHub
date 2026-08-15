#!/usr/bin/env bash
# Wrapper: load KEYED_RPC_URL from file, apply, settle.
set -euo pipefail
URL_FILE="${1:-/tmp/keyed-rpc-url.txt}"
if [[ ! -f "$URL_FILE" ]]; then
  echo "FATAL: missing $URL_FILE"
  exit 2
fi
export KEYED_RPC_URL="$(tr -d '\r\n' <"$URL_FILE")"
rm -f "$URL_FILE"
cd /opt/proxyhubb
bash scripts/ops-apply-keyed-rpc.sh
