#!/usr/bin/env bash
# P6 ingress smoke (Linux/macOS). HTTP CONNECT always; SOCKS5 if :1080 open; HTTP/3 if curl --http3-only works.
set -euo pipefail
cd "$(dirname "$0")/.."
exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(pwd)/scripts/p6-ingress-smoke.ps1" "$@" 2>/dev/null || {
  echo "Run from repo root on Windows, or implement native bash SOCKS5 in a follow-up."
  echo "Minimum: curl -x http://user:pass@127.0.0.1:\${EDGE_GATEWAY_PORT:-8090} https://example.com/"
  exit 1
}
