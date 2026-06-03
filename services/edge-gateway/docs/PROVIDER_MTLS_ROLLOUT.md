# Provider tunnel mTLS rollout plan

**Status:** Opt-in (`TLS_REQUIRE_CLIENT_CERT=false` default) until fleet certificates are issued.  
**Related:** [`tls.rs`](../src/tls.rs), ADR 0004, [`README.md`](../README.md).

## Current state (v2)

| Control | Default | Effect |
|---------|---------|--------|
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | set in compose | Server TLS on tunnel port `:3128` |
| `TLS_CA_FILE` | optional | Client CA for verification when mTLS required |
| `TLS_REQUIRE_CLIENT_CERT` | `false` | Providers connect without presenting a client cert |
| JA3/JA4 fingerprinting | on | Behavioral signal on tunnel accept without mTLS |

mTLS is **not** required for v2 dev sign-off. Production promotion is gated on cert infrastructure below.

## Rollout phases

### Phase 0 — Inventory (week 0)

1. Count provider nodes (`provider-node` + docker/k8s).
2. Choose CA: internal PKI (step-ca, Vault PKI) or public CA with short-lived certs.
3. Define cert lifetime (recommended: 90d) and rotation lead time (7d).

### Phase 1 — Issue credentials (week 1)

Per provider node:

| Artifact | Storage |
|----------|---------|
| Client cert + key (ECDSA P-256 or Ed25519) | Provider host secret mount, never in git |
| CA bundle | Same mount + gateway `TLS_CA_FILE` |

`provider-node` must present client cert on tunnel dial (already supported when gateway requires it).

### Phase 2 — Staging enforce (week 2)

1. Deploy gateway with `TLS_CA_FILE=/app/certs/provider-ca.pem`, **`TLS_REQUIRE_CLIENT_CERT=false`** (log-only).
2. Monitor tunnel accepts without cert vs with cert.
3. Flip **`TLS_REQUIRE_CLIENT_CERT=true`** on one staging pod.
4. Run `p4-transport-smoke` + provider heartbeat E2E.

### Phase 3 — Production canary (week 3)

1. Enable mTLS on **one** production gateway replica.
2. Migrate providers in batches (10% → 50% → 100%).
3. Alert on tunnel reject rate (`edge_gateway_connection_errors`).

### Phase 4 — Prod default (week 4+)

Set in K8s manifest / compose:

```yaml
- TLS_REQUIRE_CLIENT_CERT=true
- TLS_CA_FILE=/app/certs/provider-ca.pem
```

Document rollback: set `TLS_REQUIRE_CLIENT_CERT=false` and redeploy (providers without certs reconnect).

## Verification checklist

- [ ] Provider with valid cert connects and registers in directory
- [ ] Provider without cert rejected at TLS handshake
- [ ] Expired cert rejected; rotation playbook tested
- [ ] `edge_gateway_healthy_providers` stable after rollout
- [ ] No buyer-path regression (buyer port unchanged)

## Rollback

1. Set `TLS_REQUIRE_CLIENT_CERT=false` on gateway.
2. Redeploy gateway (no provider change required).
3. Post-incident: re-enable after fixing CA/cert distribution.

## Out of scope

- Buyer-side mTLS (`BUYER_TLS_ENABLE` is separate, opt-in TLS on `:8090`).
- Automatic cert renewal inside `provider-node` (future: ACME or SPIFFE).
