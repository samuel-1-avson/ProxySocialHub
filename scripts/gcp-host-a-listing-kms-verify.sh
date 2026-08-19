#!/usr/bin/env bash
set -euo pipefail
echo ---source---
grep -n GetOraclePublicKey /opt/proxyhubb/services/control-api/internal/solana/listing_commitment.go | head
echo ---binary---
sudo docker exec proxyhubb-control-api-1 sh -c 'grep -a -c "oracle signer unavailable" /server; grep -a -c "listing commitment: register started" /server; grep -a -c "listing commitment: panic" /server'
echo ---env---
sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_LISTING_COMMITMENT
sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_SESSION_CAPABILITY
sudo docker exec proxyhubb-control-api-1 printenv USE_GCP_KMS
echo ---signbin---
ls -l /tmp/provider_sign_listing /tmp/w9d-bin/w7d-operator-join /tmp/w7-bin/w7d-operator-join 2>/dev/null | awk '{print $5,$9}'
echo ---public---
curl -fsS http://127.0.0.1:18080/v1/system/config/public | python3 -c 'import json,sys
d=json.load(sys.stdin)
disc=d.get("discovery") or {}
sc=d.get("session_capability") or {}
gw=d.get("gateway_operators") or {}
print("listing="+str(disc.get("listing_commitment_mode")))
print("cap="+str(sc.get("session_capability_mode")))
print("slash="+str(gw.get("live_economic_slash")))
'
