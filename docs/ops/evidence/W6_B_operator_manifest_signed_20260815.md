# Evidence: Wave 6.B pinned operator manifests signed — 2026-08-15

## Verdict

**PASS** — `W6B_MANIFEST_SIGNED_OK` + `W7B_BUNDLE_VERIFY_OK` (2/2 on both hosts).

**Not claimed:** foreign org, `multi_org`, W7.D, operator-minted CONNECT,
`live_economic_slash=true`, DePIN. Both signing keys are held by the
platform, so this is honest self-attestation, not third-party attestation.

## Why

The W10.D pin was real but **unsigned**. On 2026-08-14 the Host-A API-down
reconstruct had to fall back to `w7b-manifest-bundle list` because `verify`
exited non-zero:

```
edge-a host_id=gce-proxyhubb-testnet verified=false unsigned
edge-b host_id=gce-w6-operator-b   verified=false unsigned
verified=0 failed=2
```

A pinned discovery copy nobody can verify is a cache, not a commitment.
`gateways.SeedFromEnv` already signs seeded rows when
`GATEWAY_OP_*_SIGNING_KEY` is set; the keys were simply never generated.

## What changed

| Item | Value |
|------|--------|
| edge-a manifest pubkey | `GjUwyJBZqFzawDguwuP3WtJTuAGLLkSzQ6nN5P3EMNAT` |
| edge-b manifest pubkey | `H4fX8X8xLLyuJWmoCzKGjaAG7yRNpJQTCb6zLU5LkMP3` |
| Seeds | generated on Host-A into `/opt/proxyhubb/.env` (`chmod 600`), never printed |
| Overlay | `docker-compose.w6-host-a-private.yml` now passes `GATEWAY_OP_A/B_SIGNING_KEY` |
| Manifest TTL | 30 days (`PROXYHUB_OPERATOR_MANIFEST_TTL_HOURS`), re-signed on every control-api start |

Env backup `/opt/proxyhubb/.env.bak.w6b-sign-20260815065837`; pinned-bundle
backups alongside each pin.

## Proof

Host-A after `--force-recreate --no-deps control-api` with all five overlays
(`docker-compose.yml` + `testnet` + `gcp-testnet` + `w6-host-a-private` +
`w10-observe`), no `--remove-orphans`:

```
api_up=1
session_capability=observe
gateway_op_a=gce-proxyhubb-testnet
gateway_op_b=gce-w6-operator-b
ok edge-a
ok edge-b
verified=2 failed=0 discovery_sot=bundle
W7B_BUNDLE_VERIFY_OK
container_pin_readable=1
W6B_MANIFEST_SIGNED_OK
```

Laptop, against the public endpoint (no Postgres, no VM access):

```
curl https://api.proxyhubb.com/v1/gateways/operators/bundle
verified=2 failed=0 discovery_sot=bundle
W7B_BUNDLE_VERIFY_OK
```

Host-B `/opt/proxyhubb/ops/operators-bundle.json` replaced with the signed
copy and verified in place. The Host-B edge was **not** restarted (`Up 23
hours (healthy)`, `PROXYHUB_SESSION_CAPABILITY=observe`) so the W10.A observe
window is unbroken; it picks the new pin up at its next start.

Replay:

```
CONFIRM_W6B_SIGN=1 bash /tmp/gcp-host-a-w6b-sign-operator-manifests.sh
```

Without the confirm the script is read-only. It aborts if the recreate loses
`PROXYHUB_SESSION_CAPABILITY=observe` or clears `GATEWAY_OP_*` host ids.

## Operational note

Manifests carry a 30-day expiry and are re-signed on each control-api start.
A control-api that runs untouched past **2026-09-14** will serve expired
manifests and `verify` will fail with `expired`. Either restart within the
window or raise `PROXYHUB_OPERATOR_MANIFEST_TTL_HOURS`.

## Honesty

- `operator_org_diversity` stays `same_org`
- ProxyHubb holds both manifest keys; a foreign operator would hold its own
- `operator_manifest_mode=observe` — signature is not an admission gate
- Capability admission is still `control_api_hmac`

## Non-claims

- Not W7.D / not a third-party operator
- Not operator-minted capabilities (W11.A is still in-repo)
- Not live economic slash
- Not DePIN
