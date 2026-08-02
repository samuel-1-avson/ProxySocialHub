#!/usr/bin/env bash
# Sync Google Maps credentials from GCP into local/VM .env files.
#
# Sources (in order):
#   1) Secret Manager: proxyhubb-google-maps-api-key
#      fallback → API Keys "ProxyHubb Maps JavaScript"
#   2) Secret Manager: proxyhubb-google-maps-map-id (optional Map ID)
#
# Usage:
#   bash scripts/gcp-sync-google-maps-key.sh
#   PROJECT_ID=... PROJECT_DIR=/opt/proxyhubb bash scripts/gcp-sync-google-maps-key.sh
#
# Never prints full secret values.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
SECRET_NAME="${GOOGLE_MAPS_SECRET_NAME:-proxyhubb-google-maps-api-key}"
MAP_ID_SECRET="${GOOGLE_MAPS_MAP_ID_SECRET:-proxyhubb-google-maps-map-id}"
# Default: ProxyHubb Maps JavaScript key UID in gen-lang-client-0022105784
MAPS_KEY_UID="${GOOGLE_MAPS_KEY_UID:-e7ea4632-f091-48dd-996c-4796b3e3e616}"

if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "ERROR: PROJECT_ID required (gcloud config or PROJECT_ID=...)" >&2
  exit 1
fi

KEY_FILE="$(mktemp)"
MAP_ID_FILE="$(mktemp)"
cleanup() { rm -f "${KEY_FILE}" "${MAP_ID_FILE}"; }
trap cleanup EXIT

fetch_key_from_secret() {
  gcloud secrets versions access latest \
    --secret="${SECRET_NAME}" \
    --project="${PROJECT_ID}" >"${KEY_FILE}" 2>/dev/null
}

fetch_key_from_api_keys() {
  local resource="projects/${PROJECT_ID}/locations/global/keys/${MAPS_KEY_UID}"
  gcloud services api-keys get-key-string "${resource}" \
    --format="value(keyString)" >"${KEY_FILE}"
}

upsert_env() {
  local file="$1"
  local name="$2"
  local value="$3"
  mkdir -p "$(dirname "${file}")"
  touch "${file}"
  if grep -qE "^${name}=" "${file}"; then
    local tmp
    tmp="$(mktemp)"
    awk -v n="${name}" -v v="${value}" '
      BEGIN { done=0 }
      $0 ~ ("^" n "=") { print n "=" v; done=1; next }
      { print }
      END { if (!done) print n "=" v }
    ' "${file}" >"${tmp}"
    mv "${tmp}" "${file}"
  else
    printf '\n%s=%s\n' "${name}" "${value}" >>"${file}"
  fi
}

echo "PROJECT_ID=${PROJECT_ID}"
echo "PROJECT_DIR=${PROJECT_DIR}"

if fetch_key_from_secret; then
  echo "KEY_SOURCE=secret-manager:${SECRET_NAME}"
else
  echo "KEY_SOURCE=api-keys:${MAPS_KEY_UID} (secret miss; falling back)"
  fetch_key_from_api_keys
  if gcloud secrets describe "${SECRET_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud secrets versions add "${SECRET_NAME}" --project="${PROJECT_ID}" --data-file="${KEY_FILE}" >/dev/null
    echo "SECRET_UPDATED=${SECRET_NAME}"
  else
    gcloud secrets create "${SECRET_NAME}" \
      --project="${PROJECT_ID}" \
      --replication-policy=automatic \
      --data-file="${KEY_FILE}" >/dev/null
    echo "SECRET_CREATED=${SECRET_NAME}"
  fi
fi

KEY="$(tr -d '\r\n' <"${KEY_FILE}")"
if [[ ! "${KEY}" =~ ^AIza ]] || [[ ${#KEY} -lt 30 ]]; then
  echo "ERROR: fetched value is not a Google API key" >&2
  exit 1
fi

upsert_env "${PROJECT_DIR}/.env" "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY" "${KEY}"
if [[ -d "${PROJECT_DIR}/apps/web" ]]; then
  upsert_env "${PROJECT_DIR}/apps/web/.env.local" "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY" "${KEY}"
fi

echo "KEY_PREFIX=${KEY:0:8}..."
echo "KEY_LEN=${#KEY}"

# Optional Map ID (vector + Advanced Markers)
if gcloud secrets versions access latest \
  --secret="${MAP_ID_SECRET}" \
  --project="${PROJECT_ID}" >"${MAP_ID_FILE}" 2>/dev/null; then
  MAP_ID="$(tr -d '\r\n' <"${MAP_ID_FILE}")"
  if [[ -n "${MAP_ID}" ]]; then
    upsert_env "${PROJECT_DIR}/.env" "NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID" "${MAP_ID}"
    if [[ -d "${PROJECT_DIR}/apps/web" ]]; then
      upsert_env "${PROJECT_DIR}/apps/web/.env.local" "NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID" "${MAP_ID}"
    fi
    echo "MAP_ID_SOURCE=secret-manager:${MAP_ID_SECRET}"
    echo "MAP_ID_LEN=${#MAP_ID}"
  fi
else
  echo "MAP_ID_SOURCE=unset (optional; create Map ID in GCP Map Management)"
fi

echo "SYNCED=.env (+ apps/web/.env.local if present)"
echo "OK"
