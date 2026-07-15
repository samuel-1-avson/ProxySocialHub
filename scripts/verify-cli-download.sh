#!/usr/bin/env bash
# Smoke-test public GET /v1/cli/download (checksum header + file size).
#
# Usage:
#   ./scripts/verify-cli-download.sh
#   ./scripts/verify-cli-download.sh --api-base http://localhost:18080 --platform linux --arch amd64
#
# Requires: running control-api with cli-dist mounted and SeedCLIDownloads completed.

set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:18080}"
PLATFORM="${PLATFORM:-linux}"
ARCH="${ARCH:-amd64}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-base) API_BASE="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--api-base URL] [--platform linux|windows|macos] [--arch amd64|arm64]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

API_BASE="${API_BASE%/}"
URL="${API_BASE}/v1/cli/download?platform=${PLATFORM}&arch=${ARCH}"
OUT="$(mktemp)"
HDR="$(mktemp)"
trap 'rm -f "$OUT" "$HDR"' EXIT

echo "Health check: ${API_BASE}/health"
curl -fsS "${API_BASE}/health" >/dev/null

echo "Downloading CLI: $URL"
http_code="$(curl -fsS -D "$HDR" -o "$OUT" -w '%{http_code}' "$URL")"
if [[ "$http_code" != "200" ]]; then
  echo "Download failed with HTTP $http_code" >&2
  exit 1
fi

size="$(wc -c <"$OUT" | tr -d ' ')"
if [[ "$size" -lt 1000 ]]; then
  echo "Download too small ($size bytes)" >&2
  exit 1
fi

checksum_hdr="$(grep -i '^x-checksum-sha256:' "$HDR" | tail -1 | cut -d: -f2- | tr -d ' \r')"
if [[ -z "$checksum_hdr" ]]; then
  echo "Missing X-Checksum-Sha256 response header" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  checksum_file="$(sha256sum "$OUT" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  checksum_file="$(shasum -a 256 "$OUT" | awk '{print $1}')"
else
  echo "No sha256sum or shasum available" >&2
  exit 1
fi

if [[ "$checksum_hdr" != "$checksum_file" ]]; then
  echo "Checksum mismatch: header=$checksum_hdr file=$checksum_file" >&2
  exit 1
fi

echo "CLI download OK: ${size} bytes, sha256=${checksum_file:0:16}..."
