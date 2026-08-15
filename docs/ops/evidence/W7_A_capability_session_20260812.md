# Evidence: Wave 7.A capability session token — 2026-08-12

## Verdict

**PASS** — `W7A_CAPABILITY_OK` (unit) and live `W7A_API_DOWN_CONNECT_OK` (2026-08-13).

## Exit claim

Marketplace CONNECT can be authorized by a self-contained Ed25519 token over
canonical lease bytes. The edge verifies with a configured issuer pubkey and
does **not** call control-api. Redis may still hold the blob as a cache.

gcp default stays `PROXYHUB_SESSION_CAPABILITY=off` (restored after soak).

## Live proof (2026-08-13T10:00Z, `proxyhubb-testnet`)

Soak target: host-A J2 `proxyhubb-edge-gateway-b-1` (`127.0.0.1:18091`), not the
us-west VM image (that binary was not rolled).

```
control_api_mode=enforce edge_b_mode=enforce
neg_connect=HTTP/1.1 407 Proxy Authentication Required
pos_connect=HTTP/1.1 200 OK
W7A_CAPABILITY_CONNECT_OK
api_down_connect=HTTP/1.1 200 OK
W7A_API_DOWN_CONNECT_OK
```

`CONFIRM_W7A_STOP_API=1 ./scripts/gcp-smoke-sprint-w7a-capability.sh`

After soak, mode restored to `off` (`session_mint=control_api_hmac`).

## Unit proof

```
go test ./internal/proofs/ ./internal/decentralization/ ./internal/marketplace/ -count=1 -run 'SessionCapability|AttachSessionCapability'
# CanonicalSessionCapabilityStable, SignAndVerify, tamper, enforce-without-key,
# honesty session_mint=capability_token vs control_api_hmac

cargo test --manifest-path services/edge-gateway/Cargo.toml --lib canonical_session_capability_matches_control_api session_capability_valid_local_ed25519 -- --nocapture
```

`W7A_CAPABILITY_OK`

## Changes

| Path | Role |
|------|------|
| `proofs/session_capability.go` | Canonical bytes, sign, verify |
| `marketplace/session_activation.go` | `AttachSessionCapability` into Redis |
| `redis/redis.go` | Capability fields on session blob |
| `decentralization/mode.go` | `off\|observe\|enforce` + honesty meta |
| `GET /v1/system/config/public` | `session_capability.session_mint` |
| `edge-gateway/src/auth.rs` | Local Ed25519 CONNECT verify |
| `PROXYHUB_SESSION_CAPABILITY` | Default **off** |
| `scripts/gcp-smoke-sprint-w7a-capability.sh` | CONNECT + optional API-down soak |
| `docs/ops/W7_SESSION_CAPABILITY.md` | Ops |

## Non-claims

- Not DePIN
- Token issuer may still be control-api at mint time
- W7.A soak used Redis as a cache; W7.C separately claimed Redis-optional CONNECT
- Not an on-chain lease PDA; not `programs/session`
- Live API-down soak claimed on host-A J2 edge-b; us-west edge image not rolled
