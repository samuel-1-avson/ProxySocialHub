# W2.1 live — J2 multipod on proxyhubb-testnet

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Host | proxyhubb-testnet |
| Result | `SPRINT_J2_MULTIPOD_OK` (live 2026-08-11) |

## Operator note

1. First deploy attempt failed: partial `main.rs` upload missing `SessionEscrowRequired` in `error.rs`.
2. Restored single `edge-gateway` briefly when `:8090` was down.
3. Second build succeeded; cutover hit port `3128` conflict then edge-a crash-looped without Docker network (`{}` networks) until force-recreate.
4. After recreate: edge-a + edge-b healthy; public `:8090` served by edge-a; smoke script run for `SPRINT_J2_MULTIPOD_OK`.

## Non-claims

- Same-VM PARTIAL multipod only
- Redis Sentinel read-replica warnings possible if `REDIS_URL` bypasses HAProxy — tune `J2_REDIS_URL` if needed
