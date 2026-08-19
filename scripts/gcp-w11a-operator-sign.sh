#!/usr/bin/env bash
# Sign a soak capability with the local operator-key.json. Seed stays here.
# Prints token JSON only (no signing_key).
set -euo pipefail
BIN="${W7A_SIGN_BIN:-/tmp/w7a-capability-sign}"
DIR="${W7D_DIR:-$HOME/proxyhubb-w7d}"
KEY="$DIR/operator-key.json"
[[ -x "$BIN" || -f "$BIN" ]] || { echo "FAIL: missing $BIN"; exit 2; }
chmod +x "$BIN"
[[ -f "$KEY" ]] || { echo "FAIL: missing $KEY"; exit 2; }
if [[ "$DIR" == *":"* ]]; then
  echo "FAIL: bad DIR"
  exit 2
fi
USER="w11a-$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
python3 - "$KEY" "$USER" <<'PY' | "$BIN" > "$DIR/w11a-token.json"
import json, sys
key = json.load(open(sys.argv[1]))
user = sys.argv[2]
assert key.get("signing_key") and key.get("pubkey")
import time, uuid
now = int(time.time())
print(json.dumps({
  "signing_key": key["signing_key"],
  "session_id": str(uuid.uuid4()),
  "offer_hash": "w11a-operator-mint-soak",
  "buyer_id": str(uuid.uuid4()),
  "expires_at": now + 7200,
  "bandwidth_limit": 1073741824,
  "operator_pubkey": key["pubkey"],
  "username": user,
  "issued_at": now,
}))
PY
if grep -q signing_key "$DIR/w11a-token.json"; then
  echo "FAIL: token file contains signing_key"
  rm -f "$DIR/w11a-token.json"
  exit 2
fi
echo "$USER" > "$DIR/w11a-username.txt"
echo "W11A_OPERATOR_SIGNED username=$USER"
python3 - "$DIR/w11a-token.json" <<'PY'
import json, sys
j = json.load(open(sys.argv[1]))
print("issuer=" + str(j.get("issuer_pubkey", "")))
PY
