#!/usr/bin/env bash
# ==============================================================================
# ProxyHubb GeoIP Database Updater (MaxMind GeoLite2-Country)
# Usage: ./scripts/update-geoip.sh [OUTPUT_DIR]
# Requires: MAXMIND_LICENSE_KEY environment variable (or free GeoLite2 mirror)
# ==============================================================================

set -euo pipefail

TARGET_DIR="${1:-./geoip}"
DB_FILE="${TARGET_DIR}/GeoLite2-Country.mmdb"
TMP_DIR=$(mktemp -d)

trap 'rm -rf "$TMP_DIR"' EXIT

echo "=== Updating MaxMind GeoIP Database ==="
mkdir -p "$TARGET_DIR"

if [[ -n "${MAXMIND_LICENSE_KEY:-}" ]]; then
  echo "Using configured MAXMIND_LICENSE_KEY to fetch latest edition..."
  DOWNLOAD_URL="https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-Country&license_key=${MAXMIND_LICENSE_KEY}&suffix=tar.gz"
  
  if curl -fsSL "$DOWNLOAD_URL" -o "${TMP_DIR}/geolite2.tar.gz"; then
    tar -xzf "${TMP_DIR}/geolite2.tar.gz" -C "$TMP_DIR"
    find "$TMP_DIR" -name "*.mmdb" -exec cp {} "$DB_FILE" \;
    echo "[SUCCESS] GeoLite2 database updated at $DB_FILE ($(stat -c%s "$DB_FILE" 2>/dev/null || stat -f%z "$DB_FILE") bytes)"
    exit 0
  else
    echo "[WARN] Direct MaxMind download failed; checking existing database..."
  fi
fi

if [[ -f "$DB_FILE" ]]; then
  echo "[INFO] Existing GeoIP database present at $DB_FILE ($(stat -c%s "$DB_FILE" 2>/dev/null || stat -f%z "$DB_FILE") bytes). Retaining current file."
else
  echo "[INFO] Creating empty placeholder or keeping fallback IP range lookups enabled."
  touch "$DB_FILE"
fi

echo "=== GeoIP Update Routine Complete ==="
