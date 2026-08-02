#!/usr/bin/env bash
# Wire BC-08 cold treasury (pubkey-only in app) on GCP testnet VM.
# Private key stays in Secret Manager / VM secrets — never mounted into control-api.
set -euo pipefail
cd /opt/proxyhubb

SECRETS_DIR=/opt/proxyhubb/secrets
COLD_FILE="${SECRETS_DIR}/treasury-cold-keypair.json"
SECRET_KP="${SECRET_COLD_KP:-proxyhubb-testnet-treasury-cold-keypair}"
SECRET_PUB="${SECRET_COLD_PUB:-proxyhubb-testnet-treasury-cold-pubkey}"
ORACLE_PUB=8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2
HOT_PUB=FeunrDoACmUi4fFQtiw3fPHAqB3N9UrAsj8ZzqSsGPa3

sudo mkdir -p "${SECRETS_DIR}"
sudo chmod 700 "${SECRETS_DIR}"

if [[ ! -f "${COLD_FILE}" ]]; then
  echo "=== generate cold keypair on VM ==="
  # Redirect solana-keygen stdout (includes seed phrase) to a shredded temp file.
  TMP_OUT="$(mktemp)"
  sudo docker run --rm --entrypoint solana-keygen \
    -v "${SECRETS_DIR}:/out" \
    solanalabs/solana:v1.18.26 \
    new --no-bip39-passphrase -o /out/treasury-cold-keypair.json --force >"${TMP_OUT}" 2>&1
  sudo shred -u "${TMP_OUT}" 2>/dev/null || sudo rm -f "${TMP_OUT}"
  sudo chmod 600 "${COLD_FILE}"
  sudo chown root:root "${COLD_FILE}"
  echo "GENERATED ${COLD_FILE}"
else
  echo "Using existing ${COLD_FILE}"
fi

COLD_PUB="$(sudo docker run --rm --entrypoint solana-keygen \
  -v "${COLD_FILE}:/k.json:ro" \
  solanalabs/solana:v1.18.26 pubkey /k.json)"
echo "COLD_PUB=${COLD_PUB}"

if [[ "${COLD_PUB}" == "${ORACLE_PUB}" || "${COLD_PUB}" == "${HOT_PUB}" ]]; then
  echo "FATAL: cold pubkey collides with oracle or hot" >&2
  exit 1
fi

echo "=== Secret Manager ==="
if ! gcloud secrets describe "${SECRET_KP}" >/dev/null 2>&1; then
  gcloud secrets create "${SECRET_KP}" --replication-policy=automatic
fi
if ! gcloud secrets describe "${SECRET_PUB}" >/dev/null 2>&1; then
  gcloud secrets create "${SECRET_PUB}" --replication-policy=automatic
fi
sudo cat "${COLD_FILE}" | gcloud secrets versions add "${SECRET_KP}" --data-file=-
printf '%s' "${COLD_PUB}" | gcloud secrets versions add "${SECRET_PUB}" --data-file=-

echo "=== .env ==="
ENV_FILE=/opt/proxyhubb/.env
sudo cp "${ENV_FILE}" "${ENV_FILE}.bak.cold-$(date -u +%Y%m%d%H%M%S)"
if grep -q '^SOLANA_TREASURY_COLD_ADDRESS=' "${ENV_FILE}"; then
  sudo sed -i "s|^SOLANA_TREASURY_COLD_ADDRESS=.*|SOLANA_TREASURY_COLD_ADDRESS=${COLD_PUB}|" "${ENV_FILE}"
else
  echo "SOLANA_TREASURY_COLD_ADDRESS=${COLD_PUB}" | sudo tee -a "${ENV_FILE}" >/dev/null
fi
grep '^SOLANA_TREASURY_COLD_ADDRESS=' "${ENV_FILE}"

COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
echo "=== recreate control-api ==="
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

for i in $(seq 1 24); do
  if curl -sf http://127.0.0.1:8080/health >/dev/null; then echo HEALTH_OK; break; fi
  sleep 5
done

echo "=== env in container ==="
"${COMPOSE[@]}" exec -T control-api sh -c 'echo COLD=$SOLANA_TREASURY_COLD_ADDRESS; echo HOT=$SOLANA_TREASURY_HOT_ADDRESS'

echo "=== custody / cold logs ==="
sudo docker logs --tail 80 proxyhubb-control-api-1 2>&1 | grep -E 'BC-08|cold|COLD|custody|FATAL' || true

echo "=== treasury stats (if public) ==="
curl -sf http://127.0.0.1:8080/v1/treasury/stats 2>/dev/null | head -c 800 || \
  curl -sf http://127.0.0.1:8080/v1/crypto/treasury 2>/dev/null | head -c 800 || \
  echo "no public treasury endpoint or auth required"

echo
echo "cold=${COLD_PUB}"
echo "hot=${HOT_PUB}"
echo "oracle=${ORACLE_PUB}"
echo "NOTE: cold private key is NOT mounted into control-api (pubkey-only)."
echo DONE
