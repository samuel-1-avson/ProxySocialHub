# W7.A — Session capability (ops)

Marketplace CONNECT can be authorized by an **Ed25519 capability** over canonical
lease bytes. The edge verifies against `PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY`
**and** verified pubkeys in a pinned operator bundle (W11.A). It does **not**
call control-api at CONNECT time. Redis may still cache the blob.

## Flags

| Env | Where | Values |
|-----|--------|--------|
| `PROXYHUB_SESSION_CAPABILITY` | API + edge | `off` \| `observe` \| `enforce` (default **off**) |
| `PROXYHUB_SESSION_CAPABILITY_SIGNING_KEY` | control-api | base58 Ed25519 seed (32) or private key (64) |
| `PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY` | edge (and API honesty) | base58 32-byte pubkey; comma-separated allowlist |
| `PROXYHUB_SESSION_CAPABILITY_OPERATOR_PUBKEY` | control-api (optional) | bind token to an operator; default = issuer |
| `PROXYHUB_SESSION_CAPABILITY_LOCAL_OPERATOR_PUBKEY` | edge (optional) | reject tokens bound to a different operator |
| `PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT` | API honesty | `off` (default) \| `observe` \| `enforce` / `true`. Does **not** change CONNECT. `session_mint=operator_capability` only with capability **enforce** plus this flag. |
| `PROXYHUB_OPERATOR_BUNDLE_{PATH,URL,CID}` | edge + API | Pin. Verified bundle pubkeys are extra issuers. Unverified rows are not. |

`true` / `on` aliases **observe** (not enforce).

## Honesty

`GET /v1/system/config/public` → `session_capability`:

- `session_mint=control_api_hmac` when capability is off/observe and HMAC proof is on
- `session_mint=capability_token` when capability **enforce** (platform mint)
- `session_mint=operator_capability` only when **enforce** and
  `PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT` is on. Observe must not claim this.
- `session_capability_issuer=control_api` when no operator bundle is pinned
- `session_capability_issuer=operators_and_control_api` when a bundle pin is set
  (W11.A). Control-api may still mint as a cache.

## Canonical bytes

```
PROXYHUB_SESSION_CAPABILITY:v1:{session_id}|{offer_hash}|{buyer_id}|{expires}|{bandwidth}|{operator_pubkey}|{username_hash}|{issued_at}
```

`offer_hash` is `listing_offer_hash`, else listing id. Not a lease PDA.

## Soak

```bash
# After setting enforce + keys on API and edges, rebuild/restart those services.
CONFIRM_W7A_STOP_API=1 ./scripts/gcp-smoke-sprint-w7a-capability.sh
```

Stopping control-api is gated. Without the confirm env, the script still checks
CONNECT with a signed Redis blob (`W7A_CAPABILITY_CONNECT_OK`).

Live `W7A_API_DOWN_CONNECT_OK` claimed 2026-08-13 on host-A J2
`proxyhubb-edge-gateway-b-1` (`127.0.0.1:18091`). Mode restored to **off**.
See [`evidence/W7_CLAIMED_20260813.md`](evidence/W7_CLAIMED_20260813.md).

## W7.C — Redis-optional CONNECT

With `PROXYHUB_SESSION_CAPABILITY=enforce`, the CONNECT password may be a compact
token `phubb1.` + base64url(JSON of lease fields + signature + issuer). The edge
verifies Ed25519 locally and **does not GET Redis `session:`**. Usage WAL still
tries Redis and treats a miss as 0 bytes used.

`GET /v1/orders/:id/credentials` always puts HMAC in
`proxy_credentials.password` (public `:8090`). When capability mint succeeds,
`session_capability` is the `phubb1.` soak token (Host-A `:18091`).
`legacy_password` aliases HMAC. `auth_for_endpoint` is `hmac` while the
published buyer endpoint is the HMAC control group. Do not send `phubb1.` to
`:8090`.

Honesty (`session_capability` on `GET /v1/system/config/public`):

- `redis_optional_connect=true` when enforce
- `remaining_spof=token_issuer` when enforce
- `admission_sot=capability_token` when enforce

```bash
./scripts/gcp-smoke-sprint-w7c-redis-optional.sh
# Optional extra: SET then DEL Redis key and CONNECT again
CONFIRM_W7C_DELETE_REDIS=1 ./scripts/gcp-smoke-sprint-w7c-redis-optional.sh
```

Live `W7C_REDIS_DELETE_CONNECT_OK` claimed 2026-08-13 on the same J2 edge-b.
Mode restored to **off**.

## W11.A — Operator issuers

Operators mint with `cmd/w7a-capability-sign` using the bundle `signing_key`
(issuer pubkey must match a **verified** row). Platform env key remains valid.

Live soak of `session_mint=operator_capability` claimed 2026-08-19
(`W11A_OPERATOR_MINT_CONNECT_OK` + `W7C_REDIS_OPTIONAL_CONNECT_OK`) on Host-A
J2 `:18091` and Host-B. Public `:8090` stays HMAC. The 08-14 soak edge binary
took extra issuers from comma-separated
`PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY` (not in-process bundle
`verified_issuer_pubkeys`).

Evidence: [`evidence/W11_A_operator_mint_issuers_20260814.md`](evidence/W11_A_operator_mint_issuers_20260814.md)
(in-repo) and
[`evidence/W11_A_enforce_soak_20260819.md`](evidence/W11_A_enforce_soak_20260819.md)
(live).

## Non-claims

- Not DePIN
- Issuer may still be control-api at mint
- Redis may still cache the blob (W7.A) or hold usage counters (W7.C)
- Not `programs/session` / on-chain lease PDA
- Host-B still `same_org` (not a foreign org; W11.B is the join-host cache)
