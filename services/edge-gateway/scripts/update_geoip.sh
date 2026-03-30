#!/usr/bin/env bash
# update_geoip.sh — Download the latest GeoLite2-Country database from MaxMind
# and hot-swap it in place so the edge-gateway picks it up on the next lookup
# without requiring a service restart.
#
# Required environment variables:
#   MAXMIND_LICENSE_KEY  — MaxMind account license key
#   GEOIP_DB_PATH        — Absolute path to the mmdb file, e.g. /data/GeoLite2-Country.mmdb
#
# Optional:
#   MAXMIND_ACCOUNT_ID   — Required for GeoIP2 (commercial); not needed for GeoLite2
#
# Usage (manual):
#   MAXMIND_LICENSE_KEY=xxx GEOIP_DB_PATH=/data/GeoLite2-Country.mmdb ./scripts/update_geoip.sh
#
# Usage (weekly cron inside container — add to crontab or Dockerfile CMD wrapper):
#   0 3 * * 0 /app/scripts/update_geoip.sh >> /var/log/geoip_update.log 2>&1

set -euo pipefail

MAXMIND_LICENSE_KEY="${MAXMIND_LICENSE_KEY:-}"
GEOIP_DB_PATH="${GEOIP_DB_PATH:-/data/GeoLite2-Country.mmdb}"
EDITION="GeoLite2-Country"
DOWNLOAD_URL="https://download.maxmind.com/app/geoip_download?edition_id=${EDITION}&license_key=${MAXMIND_LICENSE_KEY}&suffix=tar.gz"

if [ -z "${MAXMIND_LICENSE_KEY}" ]; then
    echo "[geoip-update] ERROR: MAXMIND_LICENSE_KEY is not set. Skipping update." >&2
    exit 1
fi

DB_DIR="$(dirname "${GEOIP_DB_PATH}")"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "[geoip-update] Downloading ${EDITION} database..."
curl --silent --fail --retry 3 --retry-delay 5 \
    -o "${TMP_DIR}/${EDITION}.tar.gz" \
    "${DOWNLOAD_URL}"

echo "[geoip-update] Extracting..."
tar -xzf "${TMP_DIR}/${EDITION}.tar.gz" -C "${TMP_DIR}"

# The tarball contains a versioned subdirectory; find the .mmdb inside it.
MMDB_FILE="$(find "${TMP_DIR}" -name "${EDITION}.mmdb" | head -1)"
if [ -z "${MMDB_FILE}" ]; then
    echo "[geoip-update] ERROR: ${EDITION}.mmdb not found in archive." >&2
    exit 1
fi

# Atomic replace: write to a temp file in the same directory then rename.
# rename(2) is atomic on POSIX filesystems, so the gateway never reads a
# partially-written file.
TMP_DEST="${DB_DIR}/${EDITION}.mmdb.tmp"
cp "${MMDB_FILE}" "${TMP_DEST}"
mv "${TMP_DEST}" "${GEOIP_DB_PATH}"

echo "[geoip-update] SUCCESS: ${GEOIP_DB_PATH} updated at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
