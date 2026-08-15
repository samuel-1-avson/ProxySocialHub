#!/usr/bin/env bash
# Provision Cloud KMS Ed25519 key and import existing Solana oracle keypair.
#
# Usage (from workstation with gcloud + openssl, oracle keypair present):
#   ORACLE_KP=./infra/oracle-keypair.json \
#   EXPECT_PUBKEY=8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2 \
#   bash scripts/gcp-kms-oracle-provision.sh
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
LOCATION="${LOCATION:-us-central1}"
KEYRING="${KEYRING:-proxyhubb-oracle}"
KEY="${KEY:-oracle-ed25519}"
ORACLE_KP="${ORACLE_KP:-./infra/oracle-keypair.json}"
EXPECT_PUBKEY="${EXPECT_PUBKEY:-8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2}"
PROTECTION="${PROTECTION:-software}"
IMPORT_JOB="${IMPORT_JOB:-oracle-import-$(date +%Y%m%d)}"

[[ -n "$PROJECT" && "$PROJECT" != "(unset)" ]] || { echo "set PROJECT or gcloud project"; exit 1; }
[[ -f "$ORACLE_KP" ]] || { echo "missing ORACLE_KP=$ORACLE_KP"; exit 1; }

echo "project=$PROJECT location=$LOCATION keyring=$KEYRING key=$KEY"

gcloud kms keyrings describe "$KEYRING" --location="$LOCATION" --project="$PROJECT" >/dev/null 2>&1 \
  || gcloud kms keyrings create "$KEYRING" --location="$LOCATION" --project="$PROJECT"

if ! gcloud kms keys describe "$KEY" --keyring="$KEYRING" --location="$LOCATION" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud kms keys create "$KEY" \
    --keyring="$KEYRING" \
    --location="$LOCATION" \
    --project="$PROJECT" \
    --purpose=asymmetric-signing \
    --default-algorithm=ec-sign-ed25519 \
    --protection-level="$PROTECTION"
fi

# Convert Solana keypair JSON (64-byte secret key array) → PKCS#8 DER for import.
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
python3 - <<PY
import json, struct, sys
from pathlib import Path
raw = json.loads(Path("$ORACLE_KP").read_text())
if isinstance(raw, dict) and "secretKey" in raw:
    sk = bytes(raw["secretKey"])
elif isinstance(raw, list):
    sk = bytes(raw)
else:
    raise SystemExit("unsupported keypair format")
if len(sk) == 64:
    seed = sk[:32]
elif len(sk) == 32:
    seed = sk
else:
    raise SystemExit(f"unexpected key len {len(sk)}")
# PKCS#8 for Ed25519: 302e020100300506032b657004220420 || seed
pkcs8 = bytes.fromhex("302e020100300506032b657004220420") + seed
Path("$TMPDIR/oracle.pkcs8.der").write_bytes(pkcs8)
print("pkcs8_len", len(pkcs8))
PY

# Create import job if needed
if ! gcloud kms import-jobs describe "$IMPORT_JOB" --keyring="$KEYRING" --location="$LOCATION" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud kms import-jobs create "$IMPORT_JOB" \
    --keyring="$KEYRING" \
    --location="$LOCATION" \
    --project="$PROJECT" \
    --import-method=rsa-oaep-3072-sha256-aes-256 \
    --protection-level="$PROTECTION"
fi

# Wait until import job is ACTIVE
for i in $(seq 1 30); do
  st=$(gcloud kms import-jobs describe "$IMPORT_JOB" --keyring="$KEYRING" --location="$LOCATION" --project="$PROJECT" --format='value(state)')
  echo "import_job_state=$st"
  [[ "$st" == "ACTIVE" ]] && break
  sleep 2
done

gcloud kms keys versions import \
  --key="$KEY" \
  --keyring="$KEYRING" \
  --location="$LOCATION" \
  --project="$PROJECT" \
  --import-job="$IMPORT_JOB" \
  --algorithm=ec-sign-ed25519 \
  --target-key-file="$TMPDIR/oracle.pkcs8.der"

VERSION=$(gcloud kms keys versions list \
  --key="$KEY" --keyring="$KEYRING" --location="$LOCATION" --project="$PROJECT" \
  --filter="state=ENABLED" --format="value(name)" | head -1)
[[ -n "$VERSION" ]] || { echo "no ENABLED key version"; exit 1; }

# Fetch PEM pubkey and convert to Solana base58 via python
gcloud kms keys versions get-public-key "$VERSION" --project="$PROJECT" > "$TMPDIR/pub.pem"
PUB=$(python3 - <<'PY'
from pathlib import Path
import sys
try:
    from cryptography.hazmat.primitives import serialization
except ImportError:
    print("NEED_CRYPTOGRAPHY", file=sys.stderr)
    sys.exit(2)
pem = Path(sys.argv[1]).read_bytes()
pub = serialization.load_pem_public_key(pem)
raw = pub.public_bytes(
    encoding=serialization.Encoding.Raw,
    format=serialization.PublicFormat.Raw,
)
ALPHABET = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
def b58(data: bytes) -> str:
    n = int.from_bytes(data, "big")
    out = bytearray()
    while n > 0:
        n, r = divmod(n, 58)
        out.append(ALPHABET[r])
    pad = 0
    for b in data:
        if b == 0:
            pad += 1
        else:
            break
    return (ALPHABET[0:1] * pad + out[::-1]).decode()
print(b58(raw))
PY
"$TMPDIR/pub.pem")

if [[ "$PUB" == "NEED_CRYPTOGRAPHY" ]] || [[ -z "$PUB" ]]; then
  echo "Install cryptography (pip install cryptography) or set GCP_KMS_PUBLIC_KEY=$EXPECT_PUBKEY manually"
  PUB="$EXPECT_PUBKEY"
fi

echo "KEY_VERSION=$VERSION"
echo "GCP_KMS_PUBLIC_KEY=$PUB"
if [[ -n "$EXPECT_PUBKEY" && "$PUB" != "$EXPECT_PUBKEY" ]]; then
  echo "WARNING: pubkey $PUB != EXPECT_PUBKEY $EXPECT_PUBKEY"
  exit 1
fi
echo PROVISION_OK
