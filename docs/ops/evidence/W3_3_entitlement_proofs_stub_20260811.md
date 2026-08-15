# W3.3 — Entitlement proofs stub (observe)

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Result | `DISC01_CREDENTIAL_PROOF_OBSERVE` |
| Default | `PROXYHUB_CREDENTIAL_PROOF=off` (gcp-testnet compose → `observe`) |

## What landed

1. Flag `PROXYHUB_CREDENTIAL_PROOF` = `off` \| `observe` in `decentralization/mode.go`.
2. `proofs.BuildOrderCredentialArtifact` — HMAC-SHA256 over payload hash using `SESSION_SECRET` (fallback `GATEWAY_SHARED_SECRET`).
3. Canonical payload binds `order_id`, `session_id`, `buyer_id`, `listing_id`, `username_hash` (password excluded), issued/expires.
4. `GET /v1/orders/:id/credentials` attaches `credential_proof` when observe is on.
5. Access Pass NFT / `ResolvePassEntitlement` untouched.

## Non-claims

- Not enforced at edge CONNECT
- Not a buyer-held VC / on-chain lease PDA
- HMAC is platform-attested observe theater until enforce + independent verify keys
- Does not replace Access Pass quota entitlement
