#!/usr/bin/env bash
# CONNECT with an operator-minted phubb1. token. No Redis session:.
#   bash /tmp/gcp-w11a-operator-connect.sh /tmp/w11a-token.json /tmp/w11a-username.txt
set -euo pipefail
TOKFILE="${1:-/tmp/w11a-token.json}"
USERFILE="${2:-/tmp/w11a-username.txt}"
EDGE_HOST="${EDGE_BUYER_HOST:-127.0.0.1}"
EDGE_PORT="${EDGE_BUYER_PORT:-18091}"
[[ -f "$TOKFILE" && -f "$USERFILE" ]] || { echo "FAIL: missing token/user files"; exit 2; }
grep -q signing_key "$TOKFILE" && { echo "FAIL: token file contains signing_key"; exit 2; }
USER=$(tr -d '\r\n' < "$USERFILE")
TOKEN=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$TOKFILE")
echo "$TOKEN" | grep -q '^phubb1\.' || { echo "FAIL: not a phubb1 token"; exit 2; }
cap=$(sudo docker exec proxyhubb-edge-gateway-b-1 printenv PROXYHUB_SESSION_CAPABILITY | tr -d '\r')
[[ "$cap" == "enforce" ]] || { echo "FAIL: edge-b cap $cap"; exit 2; }

connect_code() {
  local user="$1" pw="$2"
  python3 - <<PY
import base64, socket
user=b"""$user"""; pw=b"""$pw"""
token=base64.b64encode(user+b":"+pw).decode()
s=socket.create_connection(("$EDGE_HOST", int("$EDGE_PORT")), timeout=10)
req=(f"CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: Basic {token}\r\n\r\n").encode()
s.sendall(req)
s.settimeout(10)
data=s.recv(4096)
print(data.split(b"\r\n",1)[0].decode(errors="replace"))
s.close()
PY
}

POS=$(connect_code "$USER" "$TOKEN" || true)
echo "pos_connect=$POS"
echo "$POS" | grep -Eqi 'HTTP/1\.1 200' || { echo "FAIL: expected 200 operator-minted CONNECT"; exit 2; }
echo "W11A_OPERATOR_MINT_CONNECT_OK"
