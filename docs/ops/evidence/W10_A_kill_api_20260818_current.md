# Evidence: W10.A kill-API CONNECT on the 2026-08-18 image

## Verdict

**PASS** — `W10A_KILL_API_CONNECT_OK`.

HMAC marketplace CONNECT on Host-A J2 edge-b (`127.0.0.1:18091`) succeeded
with control-api **up** and **down**. Restore was `docker start` (not
compose recreate). Capability stayed `observe`. Listing commitment stayed
`observe`. Host ids preserved. Slash dual-gates unset. Redis still
required. Not enforce. Not DePIN.

This covers the Host-A binary after the listing-commitment KMS + retry
roll (`sha256:5e84a8ffc37529a33cb66e483136fc3bcb3c01b0a9391c6ea0f998effe63346c`,
created 2026-08-18T21:49:20Z). The morning kill-API
([`W10_A_kill_api_20260818.md`](W10_A_kill_api_20260818.md)) was on the
08-17 image and does not apply here.

W10.A observe clock on this image: due **2026-08-25**.

## Proof

```
id=sha256:5e84a8ffc37529a33cb66e483136fc3bcb3c01b0a9391c6ea0f998effe63346c
api_up_connect=HTTP/1.1 200 OK
api_down_connect=HTTP/1.1 200 OK
PROXYHUB_SESSION_CAPABILITY=observe
GATEWAY_OP_A_HOST_ID=gce-proxyhubb-testnet
GATEWAY_OP_B_HOST_ID=gce-w6-operator-b
W10A_KILL_API_CONNECT_OK
```

Replay:

```
CONFIRM_W10A_KILL_API=1 bash scripts/gcp-host-a-w10a-kill-api.sh
```

## Non-claims

- HMAC still admits CONNECT in observe
- Redis-optional CONNECT (W7.C) was not claimed
- Not the stay-observe / enforce / revert decision (due **2026-08-25**)
- Not listing-commitment enforce
- Not live slash
