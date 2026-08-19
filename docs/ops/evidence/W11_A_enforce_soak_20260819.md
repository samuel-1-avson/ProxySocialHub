# Evidence: W11.A written enforce soak — 2026-08-19

## Verdict

**PASS** — `W11A_ENFORCE_APPLIED` + `W11A_OPERATOR_MINT_CONNECT_OK` +
`W7C_REDIS_OPTIONAL_CONNECT_OK` + `W7C_REDIS_DELETE_CONNECT_OK` +
`W11A_HOST_B_ENFORCE_OK` + `HMAC_CONTROL_GROUP_INTACT`.

Written **enforce** on the W10.A soak fleet. Live
`session_mint=operator_capability`, `redis_optional_connect=true`,
`remaining_spof=token_issuer`. This is the first change that can break HMAC
buyers on **new** shop credentials. Public `:8090` (`edge-a`) stayed HMAC.

Not DePIN. Listing stayed **observe**. Slash dual-gates stayed **unset**.
`live_economic_slash=false`. `programs/session` not deployed. Never
`--remove-orphans`.

Supersedes the same-day stay-observe waiver
([`W10_A_wait_waived_stay_observe_20260819.md`](W10_A_wait_waived_stay_observe_20260819.md)).

## Soak fleet

| Node | Mode | Notes |
|------|------|--------|
| Host-A `control-api` | `enforce` + `OPERATOR_MINT=enforce` | image still `sha256:5e84a8ff…` (08-18 KMS/retry). `StartedAt` `2026-08-19T05:55:05.311056752Z` |
| Host-A J2 `edge-gateway-b` `:18091` | `enforce` | image still `sha256:7ecf6078…` (08-14). `StartedAt` `2026-08-19T05:57:48.804092992Z`. Issuer allowlist **n=5** (platform + pin pubkeys via env; 08-14 binary lacks in-process `verified_issuer_pubkeys`) |
| Host-B `proxyhubb-w6-edge-b` | `enforce` | still `same_org`. Pin refreshed `bundle_n=4` |
| Host-A `edge-gateway-a` `:8090` | `off` (HMAC) | `StartedAt` **unchanged** `2026-08-13T10:01:36.652126582Z` |

Rollback tags (same binaries, observe overlays):
`proxyhubb-control-api:pre-enforce-20260819`,
`proxyhubb-edge-gateway-b:pre-enforce-20260819`.

## HMAC buyer caveat

`GET /v1/orders/:id/credentials` in enforce puts the `phubb1.` token in
`password` and keeps HMAC in `legacy_password`. Buyers that send the token
password to public `:8090` will **407**. Soak CONNECT is Host-A `:18091`.
Existing HMAC sessions on `:8090` still match `edge-a` (`PROXYHUB_SESSION_CAPABILITY=off`).

## CONNECT proofs (Host-A `:18091`)

Operator-minted (seed stayed on `proxyhubb-w7d-ext`; issuer
`AH7dzbx9wk7ekb2jQdiH6Jron5xd7Q9q6zfKMQpk9EVq`):

```
pos_connect=HTTP/1.1 200 OK
W11A_OPERATOR_MINT_CONNECT_OK
```

Platform mint, no Redis `session:<user>`, then SET+DEL:

```
honesty=session_mint=operator_capability redis_optional=True remaining_spof=token_issuer
signed_issuer=GG9tJqK1ZM2nSFruCWxuanLECvjJbveAWXrmvCiG8y8p
neg_connect=HTTP/1.1 407 Proxy Authentication Required
garbage_connect=HTTP/1.1 407 Proxy Authentication Required
pos_connect=HTTP/1.1 200 OK
W7C_REDIS_OPTIONAL_CONNECT_OK
after_del_connect=HTTP/1.1 200 OK
W7C_REDIS_DELETE_CONNECT_OK
```

## Public honesty (`https://api.proxyhubb.com`)

```
session_capability_mode=enforce
session_mint=operator_capability
session_capability_issuer=operators_and_control_api
session_capability_operator_mint=true
redis_optional_connect=true
remaining_spof=token_issuer
listing_commitment_mode=observe
operator_org_diversity=multi_org
operator_host_diversity=two_hosts
live_economic_slash=false
gateway_slash_execute=off
programs_session=unsafe_do_not_deploy
```

`GATEWAY_OP_A_HOST_ID=gce-proxyhubb-testnet`,
`GATEWAY_OP_B_HOST_ID=gce-w6-operator-b`.

## Replay

```
CONFIRM_W11A_ENFORCE=1 bash scripts/gcp-w11a-enforce-apply.sh   # Host-A
# if issuer_n=1 (sudo dropped env): scripts/gcp-w11a-edge-issuer-fix.sh
CONFIRM_W11A_ENFORCE=1 bash scripts/gcp-w11a-host-b-enforce.sh  # Host-B
# sign on foreign VM (seed stays): scripts/gcp-w11a-operator-sign.sh
bash scripts/gcp-w11a-operator-connect.sh                       # Host-A :18091
W7A_SIGN_BIN=/tmp/w7a-capability-sign CONFIRM_W7C_DELETE_REDIS=1 \
  bash scripts/gcp-smoke-sprint-w7c-redis-optional.sh
```

Overlays last: `docker-compose.w11-enforce.yml` (API),
`docker-compose.w11-enforce-edge.yml` (Host-A edge-b),
`docker-compose.w11-host-b-enforce.yml` (Host-B). Keep listing-observe.
Never `--remove-orphans`. Never recreate `edge-a`.

## Non-claims

- Not listing enforce
- Not live slash / `live_economic_slash=true`
- Not `programs/session`
- Host-B is still `same_org`
- Join hosts have **no** live CONNECT process
- 08-14 edge binary was **not** rebuilt; extra issuers are env comma-list
- Shop catalog cards / `catalog_products` were not created
- Not DePIN
