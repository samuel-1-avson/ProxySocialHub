# Evidence: P0.3 Host-B Wave 7 + HTTP operator bundle + 000151 — 2026-08-13

## Verdict

**PASS** — `W7_HOST_B_ROLL_OK` + `W7B_HTTP_BUNDLE_OK` + `W7D_MIGRATION_000151_OK` +
`W7D_JOIN_CLI_OK`. Live foreign VPS **skipped** (`W7D_EXTERNAL_VPS_SKIPPED`).

Host-B remains GCP project `gen-lang-client-0022105784` →
`operator_org_diversity=same_org`. Not W7.D live. Not DePIN.
`PROXYHUB_SESSION_CAPABILITY` stays **off**. `PROXYHUB_LISTING_COMMITMENT` stays
**off**.

## 1. Host-B Wave 7 edge binary

| Field | Value |
|-------|--------|
| VM | `proxyhubb-w6-edge-b` (us-west1-b) |
| Image | `proxyhubb-edge-gateway-a:latest` |
| Image id | `sha256:3572048f6b13e4ed3c1e01012d95ea9513e128d1e7fd1eb1253d19e1bb3729e7` (Host-A J2 Wave 7) |
| Health | `edge_pod_id=edge-b-west` |
| Capability | `PROXYHUB_SESSION_CAPABILITY=off` |

```
W7_HOST_B_ROLL_OK
same_org; not W7.D; not DePIN; capability off
```

Compose on Host-B now includes Wave 7 env keys (`PROXYHUB_SESSION_CAPABILITY*`,
`PROXYHUB_OPERATOR_BUNDLE_*`). Mode left **off**.

## 2. HTTP `GET /v1/gateways/operators/bundle`

Host-A previously routed `/bundle` as `:id` → 500 `failed to load operator`.
Registered `exportGatewayOperatorBundle` **before** `:id`, rebuilt control-api
(honesty W10.B patch retained; no Wave 8 slash symbols).

Public:

```
message_type=PROXYHUB_OPERATOR_MANIFEST_BUNDLE
n=2  (edge-a, edge-b)
```

`W7B_HTTP_BUNDLE_OK`

## 3. Migration `000151` (`org_id`)

Applied on live Postgres:

```
ALTER TABLE … ADD COLUMN org_id …
W7D_MIGRATION_000151_OK
```

Rows for Host-A/B use platform org (empty or `gen-lang-client-0022105784`).

## 4. Foreign VPS / W7.D

Join CLI (laptop): keygen → sign `org_id=ext-operator-org-1` →
`w7b-manifest-bundle verify` → `W7D_JOIN_CLI_OK`.

No volunteer VPS. Documented:

```
W7D_EXTERNAL_VPS_SKIPPED (no volunteer; Host-B remains same_org)
```

Live honesty after restore:

```
operator_host_diversity=two_hosts
operator_org_diversity=same_org
discovery_sot=postgres
listing_commitment_mode=off
listing_commitments=ed25519_offer_hash
```

## Ops note

Recreating `control-api` **without** `docker-compose.w6-host-a-private.yml`
cleared `GATEWAY_OP_*` and briefly reported `same_host` / loopback host_ids.
Restored by recreating with the W6 overlay. Future Host-A control-api rolls
must include that file.

## Non-claims

- Host-B ≠ third-party org (still `same_org`)
- Not DePIN; capability default still off
- Not listing-commitment enforce; listing mode off
- Not `programs/session`
- Not a live foreign VPS (`CONFIRM_W7D_EXTERNAL_VPS=1` unclaimed)
