# Evidence: Wave 5.C.2 credential proof CONNECT enforce — 2026-08-12

## Verdict

**PASS** — `W5C_CREDENTIAL_ENFORCE_OK` on gcp-testnet.

## Exit claim

`PROXYHUB_CREDENTIAL_PROOF=enforce` binds a platform HMAC into the Redis session at
marketplace activation; edge CONNECT rejects marketplace sessions (`listing_id` set)
when the proof is missing, expired, or invalid.

Still platform-attested HMAC (SESSION_SECRET) — not a buyer VC / on-chain lease PDA.

## Live smoke

```
control_api_mode=enforce edge_b_mode=enforce
neg_connect=HTTP/1.1 407 Proxy Authentication Required
pos_connect=HTTP/1.1 200 OK
W5C_CREDENTIAL_ENFORCE_OK
```

## Changes

| Path | Role |
|------|------|
| `decentralization/mode.go` | `enforce` mode |
| `marketplace/session_activation.go` | `AttachCredentialProof` into Redis |
| `redis/redis.go` | Proof fields on session blob |
| `edge-gateway/src/auth.rs` | CONNECT verify for marketplace sessions |
| `docker-compose.gcp-testnet.yml` / j2 | Default `enforce` |
| `scripts/gcp-smoke-sprint-w5c-credential-enforce.sh` | Smoke |

## Non-claims

- Not buyer-held verifiable credential
- Not on-chain session/lease PDA
- Non-marketplace sessions (empty `listing_id`) unchanged
- Access Pass NFT entitlement unchanged
- HMAC remains platform-secret attested
