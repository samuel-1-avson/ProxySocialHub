# Evidence: Wave 7.C Redis-optional CONNECT — 2026-08-13

## Verdict

**PASS** — `W7C_REDIS_OPTIONAL_OK` (unit) and live `W7C_REDIS_DELETE_CONNECT_OK`
(2026-08-13).

Live Redis-delete CONNECT ran on host-A J2 `proxyhubb-edge-gateway-b-1`
(`127.0.0.1:18091`) with `PROXYHUB_SESSION_CAPABILITY=enforce`, then mode was
restored to `off`.

## Exit claim

With capability **enforce**, marketplace CONNECT succeeds when the buyer presents
a `phubb1.` token **even if Redis `session:` is missing**. The edge verifies
Ed25519 locally. Remaining SPOF is whoever signed the token.

gcp default stays `PROXYHUB_SESSION_CAPABILITY=off`.

## Unit proof

```
go test ./internal/proofs/ ./internal/decentralization/ ./internal/marketplace/ -count=1 -run 'SessionCapability|EncodeDecode|IssueSessionCapabilityToken|redis_optional'
# Encode/decode phubb1. token, bad prefix/version, IssueSessionCapabilityToken,
# honesty redis_optional_connect + remaining_spof=token_issuer

cargo test --manifest-path services/edge-gateway/Cargo.toml --bin edge-gateway capability -- --nocapture
# capability_token_roundtrip_admits_without_redis
# capability_token_bad_prefix_and_payload_rejected
# capability_token_unsupported_version_rejected
```

`W7C_REDIS_OPTIONAL_OK`

## Live proof (2026-08-13T10:01Z, `proxyhubb-testnet`)

Soak target: host-A J2 `proxyhubb-edge-gateway-b-1` (`127.0.0.1:18091`) with
`PROXYHUB_SESSION_CAPABILITY=enforce`. CONNECT password was `phubb1.` capability;
Redis `session:` was missing, then SET+DEL.

```
redis_session_exists=0
neg_connect=HTTP/1.1 407 Proxy Authentication Required
garbage_connect=HTTP/1.1 407 Proxy Authentication Required
pos_connect=HTTP/1.1 200 OK
W7C_REDIS_OPTIONAL_CONNECT_OK
after_del_connect=HTTP/1.1 200 OK
W7C_REDIS_DELETE_CONNECT_OK
remaining_spof=token_issuer
```

`CONFIRM_W7C_DELETE_REDIS=1 ./scripts/gcp-smoke-sprint-w7c-redis-optional.sh`

After soak, mode restored to `off` (`session_mint=control_api_hmac`,
`redis_optional_connect=false`).

## Changes

| Path | Role |
|------|------|
| `proofs/session_capability.go` | `phubb1.` encode/decode |
| `marketplace/session_activation.go` | `IssueSessionCapabilityToken` |
| `GET /v1/orders/:id/credentials` | Token as CONNECT password in enforce |
| `decentralization/mode.go` | `redis_optional_connect`, `remaining_spof` |
| `edge-gateway/src/auth.rs` | Token-first CONNECT; no Redis `session:` GET |
| `cmd/w7a-capability-sign` | Emits `token` |
| `scripts/gcp-smoke-sprint-w7c-redis-optional.sh` | Missing-key CONNECT + optional DEL |

## Non-claims

- Not DePIN
- Token issuer may still be control-api at mint time
- Usage counters may still use Redis/WAL (admission only)
- Not an on-chain lease PDA; not `programs/session`
- Live Redis-delete soak claimed on host-A J2 edge-b; us-west edge image not rolled
