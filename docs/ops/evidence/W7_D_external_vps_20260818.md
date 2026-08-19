# Evidence: Wave 7.D live foreign operator — 2026-08-18

## Verdict

**PASS** — `W7D_EXTERNAL_VPS_OK` + `W7D_PG_CACHE_OK` + `W7D_CONTROL_API_UNTOUCHED`.

Public `GET https://api.proxyhubb.com/v1/system/config/public` →
`gateway_operators.operator_org_diversity=multi_org`.

Host-B (`proxyhubb-w6-edge-b` in `gen-lang-client-0022105784`) still does **not**
count. This row is a **different GCP project**. Same Google account and the
same billing account as other personal projects; not a third-party company;
not permissionless join; not DePIN.

Host-A `control-api` was **not** recreated or restarted (W10.A observe clock
stays). Capability stayed `observe`. Listing stayed `observe`. Slash dual-gates
stayed unset. `live_economic_slash=false`. Seed never left the foreign VM.

## Foreign host

| Field | Value |
|-------|--------|
| GCP project / `org_id` | `fiffi-500411` |
| VM | `proxyhubb-w7d-ext` (us-central1-a, `e2-micro`) |
| Public IP | `35.224.195.113` |
| `host_id` | `gce-proxyhubb-w7d-ext` |
| slug | `edge-ext` |
| pubkey | `AH7dzbx9wk7ekb2jQdiH6Jron5xd7Q9q6zfKMQpk9EVq` |
| Seed path (stays on VM) | `/home/samue/proxyhubb-w7d/operator-key.json` |

Keygen + `sign-from-keygen` ran **on that VM**. Only
[`W7_D_operators_ext_20260818.json`](W7_D_operators_ext_20260818.json) left the
box (no `signing_key`).

No edge-gateway process is running on this micro. Buyer/health URLs in the
manifest are documentation, not a live CONNECT target. `bonded=true` is the
W6.B observe hook field — **no** new `gateway-bond` tx for this pubkey.

## Host-A cache (no roll)

`INSERT` into `gateway_operators` (directory cache). No
`GATEWAY_OP_*_SIGNING_KEY` for `edge-ext`. SeedFromEnv still only upserts
`edge-a` / `edge-b`.

```
INSERT 0 1
edge-a  gen-lang-client-0022105784  gce-proxyhubb-testnet
edge-b  gen-lang-client-0022105784  gce-w6-operator-b
edge-ext  fiffi-500411              gce-proxyhubb-w7d-ext
```

`proxyhubb-control-api-1` `StartedAt` before and after:

```
2026-08-18T22:19:07.846230183Z
```

Pinned reconstruct file `/opt/proxyhubb/ops/operators-bundle.json` merged to
`n=3` (`edge-a,edge-b,edge-ext`) by file copy only. Same `StartedAt`.

## Public honesty (2026-08-18)

```
operator_org_diversity=multi_org
operator_host_diversity=two_hosts
platform_org_id=gen-lang-client-0022105784
foreign_operator_key_rotation=operator_only
discovery_sot=postgres_cache
session_capability_mode=observe
session_mint=control_api_hmac
live_economic_slash=false
programs_session=unsafe_do_not_deploy
W7D_EXTERNAL_VPS_OK
```

`GET /v1/gateways/operators` returns **3** slugs including `edge-ext` /
`org_id=fiffi-500411`.

`operator_host_diversity` stays the enum `two_hosts` (“at least two”
non-loopback `host_id`s). A third host does not change that label.

## Scripts

- `scripts/gcp-w7d-ext-join.sh` — keygen/sign on the foreign VM
- `scripts/gcp-w7d-cache-foreign-operator.sh` — Postgres cache, no restart
- `scripts/gcp-w7d-merge-pinned-bundle.sh` — merge into pinned bundle file

## Non-claims

- Not DePIN
- Not a volunteer outside this Google account
- Not permissionless shop merchandising
- Not operator-minted CONNECT (`session_mint` still HMAC)
- Not a live bonded slash; no `programs/session`
- Not Host-B
- Edge process on `proxyhubb-w7d-ext` not deployed (join host only)
- e2-micro is billable in `fiffi-500411`; stop/delete when the soak is done

Follow-up 2026-08-18: distinct `gateway-bond`
([`W12_B_edge_ext_bond_20260818.md`](W12_B_edge_ext_bond_20260818.md);
PDA `HxmZVafPyn4NEcxwzCnX1eGwni7E7CEj42Bj2wnZYBAM`).
