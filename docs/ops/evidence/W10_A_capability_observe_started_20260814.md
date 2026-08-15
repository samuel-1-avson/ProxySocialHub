# Evidence: Wave 10.A capability observe **started** — 2026-08-14

## Verdict

**STARTED** — `W10A_OBSERVE_STARTED` + `W10A_KILL_API_CONNECT_OK` (week 1).

Not complete. Observe must run **≥7 days**. Written decision is due
**2026-08-21**. Next weekly kill-API CONNECT: **2026-08-21**. Mode was **not**
restored off. Not DePIN. Issuer is still control-api
(`GG9tJqK1ZM2nSFruCWxuanLECvjJbveAWXrmvCiG8y8p`).

## Soak fleet

| Node | Mode | Notes |
|------|------|--------|
| Host-A `control-api` | `observe` | mints/attaches capability; HMAC still admission |
| Host-A J2 `edge-gateway-b` (`:18091`) | `observe` | issuer pubkey pinned |
| Host-B `proxyhubb-w6-edge-b` (`edge-b-west`) | `observe` | same issuer; **same_org** |
| Host-A `edge-gateway-a` (`:8090`) | left off | HMAC control group |

Slash dual-gates **unset**. Listing commitment **off**.
`live_economic_slash=false`. `operator_org_diversity=same_org`.
`operator_host_diversity=two_hosts`. GATEWAY_OP host ids preserved
(`gce-proxyhubb-testnet` / `gce-w6-operator-b`).

## Honesty (live `https://api.proxyhubb.com`)

```
session_capability_mode=observe
session_mint=control_api_hmac
remaining_spof=control_api_hmac_and_redis
```

WAVE10’s “`remaining_spof=token_issuer` while observe” line is the **enforce**
label. Observe still HMAC-gates CONNECT; honesty stays `control_api_hmac_and_redis`.

## Week-1 kill-API CONNECT

HMAC marketplace session (credential proof) on Host-A J2 edge-b:

```
api_up_connect=HTTP/1.1 200 OK
api_down_connect=HTTP/1.1 200 OK
W10A_KILL_API_CONNECT_OK
```

control-api was stopped, CONNECT succeeded, API restarted healthy. Redis still
required in observe (not W7.C Redis-optional).

## Replay

```
CONFIRM_W10_PHASE_A=1 CONFIRM_W10A_KILL_API=1 \
  bash scripts/gcp-smoke-sprint-w10a-capability-observe.sh   # Host-A
CONFIRM_W10_PHASE_A=1 \
  bash scripts/gcp-smoke-sprint-w10-host-b-observe.sh        # Host-B
```

Do **not** restore off until the 2026-08-21 decision record.

## Non-claims

- Not enforce; HMAC is still admission
- Not operator-minted capabilities (W11.A)
- Host-B ≠ org 2
- Not DePIN / not `programs/session`
