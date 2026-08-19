# ADR 0013 — Federated session mint (Wave 7)

- **Status:** Accepted for D1–D2 and W7.C. Live A–C claimed 2026-08-13
  (`W7_CLAIMED_20260813.md`). W7.D honesty/join path implemented 2026-08-13
  (live foreign VPS claimed 2026-08-18). D5 operator issuers in-repo 2026-08-14;
  live `operator_capability` soak 2026-08-19. D3 remains open (`programs/session`).
- **Date:** 2026-08-12
- **Related:** ADR 0012, `WAVE7_DECENTRALIZATION_PLAN.md`, W5.C.2 credential HMAC
- **Non-goals:** DePIN marketing, unsafe `programs/session`, trustless egress

---

## Context

Wave 6 proved a second-host **data plane**. Session admission is still:

```
control-api ActivateOrderSession
  → Redis session:<user> + HMAC(SESSION_SECRET)
edge CONNECT → Redis GET → verify HMAC
```

Control-api down ⇒ no new sessions. Redis down ⇒ no CONNECT. That is why
ProxyHubb is not a DePIN.

W5.C.2 correctly refused to call the HMAC a buyer VC or lease PDA.

## Decision

### D1 — Split mint from verify

| Step | Today | Wave 7 target |
|------|--------|----------------|
| Issue credential | control-api only | control-api (or operator) **mints** a capability |
| Store | Redis required | Redis optional cache |
| Verify at CONNECT | Redis + shared `SESSION_SECRET` | Local Ed25519 (or equivalent) over canonical lease bytes |
| Issuer online? | Required for new sessions; Redis required always | **Not required at CONNECT** after mint |

The DePIN-shaped test is `W7A_API_DOWN_CONNECT_OK`, not “buyer self-issues.”
W7.A shipped: `PROXYHUB_SESSION_CAPABILITY=off|observe|enforce` (default off),
canonical `PROXYHUB_SESSION_CAPABILITY:v1:…` Ed25519, edge local verify,
honesty `session_mint`. Live `W7A_API_DOWN_CONNECT_OK` claimed 2026-08-13 on
host-A J2 edge-b (us-west Host-B image not rolled). Mode restored to **off**.

W7.C shipped: CONNECT password `phubb1.<token>` is admitted in **enforce** without
Redis `session:`. Invalid `phubb1.` prefix does not fall back to Redis. Remaining
SPOF is the **token issuer** (`remaining_spof=token_issuer`). Usage/metering may
still use Redis/WAL. Live `W7C_REDIS_DELETE_CONNECT_OK` claimed 2026-08-13; mode
restored to **off**.

### D2 — Discovery is a cache

W6.B manifests are the portable object. Postgres `GET /v1/gateways/operators`
becomes a cache. A signed bundle (file/IPFS) must reconstruct the operator set.

W7.B shipped: `PROXYHUB_OPERATOR_MANIFEST_BUNDLE` JSON, `GET /v1/gateways/operators/bundle`,
`cmd/w7b-manifest-bundle` verify/list without the API, edge pin
`PROXYHUB_OPERATOR_BUNDLE_PATH|URL|CID` (skips live directory GET), honesty
`discovery_sot=postgres_cache`. Live `W7B_BUNDLE_VERIFY_OK` claimed 2026-08-13
(CLI reconstruct with API down). HTTP bundle export was **not** claimed.

### D3 — Do not use `programs/session`

On-chain lease PDAs are a later wave and need a **safe** program. Wave 7 is
off-chain capabilities + optional Redis. Unsafe `complete_session` /
`slash_gateway` remain undeployed. Wave 8 bonded slash lives in
`programs/gateway-bond` (ADR 0014), not session.

### D4 — Honest DePIN gate

Do **not** say DePIN after Wave 7. Remaining after A–D join path:

- Token issuer can still be ProxyHubb
- Host-B is still the same GCP org until a **foreign** `org_id` is live (`operator_org_diversity=multi_org`)
- No live bonded slash (Wave 8)
- Catalog/settlement still Postgres-primary (Wave 9)
- Metering still edge-attested (ADR 0010)

W7.D shipped in-repo: `org_id` on operators, honesty `operator_org_diversity`,
seed cannot overwrite a foreign pubkey, `cmd/w7d-operator-join` keygen/sign.
Live volunteer VPS is script-gated (`CONFIRM_W7D_EXTERNAL_VPS=1`) and **unclaimed**.
Wave 7 A–C live claim: [`W7_CLAIMED_20260813.md`](../ops/evidence/W7_CLAIMED_20260813.md).

## Addendum — D5 Operator issuers (Wave 11.A) — 2026-08-14

Edges accept capability issuers from:

1. `PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY` (platform, comma-separated)
2. **Verified** pubkeys in the pinned operator bundle
   (`PROXYHUB_OPERATOR_BUNDLE_PATH|URL|CID`)

Unverified bundle rows are not issuers. Canonical bytes stay
`PROXYHUB_SESSION_CAPABILITY:v1:…`. Operators mint with
`cmd/w7a-capability-sign` and their bundle signing key. Control-api may still
mint as a convenience cache.

Honesty:

- `session_capability_issuer=operators_and_control_api` when a bundle pin is
  configured; otherwise `control_api`
- `session_mint=operator_capability` only when
  `PROXYHUB_SESSION_CAPABILITY=enforce` **and**
  `PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT` is on
- W10.A observe (`session_mint=control_api_hmac`) must not claim
  `operator_capability` while HMAC still gates CONNECT

Live enforce soak of operator-minted CONNECT claimed 2026-08-19
([`W11_A_enforce_soak_20260819.md`](../ops/evidence/W11_A_enforce_soak_20260819.md)).
This addendum is not DePIN. `operator_org_diversity=multi_org` is a separate
W7.D / W11.B cache claim.

Evidence: [`W11_A_operator_mint_issuers_20260814.md`](../ops/evidence/W11_A_operator_mint_issuers_20260814.md)
(in-repo).

## Consequences

- Edges must learn issuer pubkeys (operator manifests / protocol key set).
- `SESSION_SECRET` HMAC remains for legacy / non-marketplace sessions until
  enforce is on.
- Shared Redis can shrink to metering WAL, not admission SoT.
