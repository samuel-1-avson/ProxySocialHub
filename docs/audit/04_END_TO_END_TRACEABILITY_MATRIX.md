# 04 — End-to-End Feature Traceability Matrix

Each trace lists the actual implemented path (file references) and marks the break/uncertainty point if any. Legend: ✅ implemented & connected · ⚠️ implemented with caveats · ❌ broken/disconnected.

## T1 — User registration & login ✅

```
apps/web /login → auth.tsx:376-437
→ POST /v1/auth/wallet/challenge (auth.go:73+; nonce in Redis)
→ wallet signs (solana wallet adapter)
→ POST /v1/auth/wallet/login (Ed25519 verify; user upsert in profiles/wallets)
→ JWT (HS256) + HttpOnly refresh cookie
→ middleware guards (proxyhub_token) → dashboard
```
Breaks: none found. Role selection is post-hoc (provider application), not at signup.

## T2 — Provider onboarding ✅

```
/dashboard/become-provider → POST /v1/provider/apply → admin review (/v1/admin/provider/applications*)
→ /dashboard/provider/setup → POST /v1/provider/nodes (provider_nodes.go) + POST /v1/provider/tokens
→ CLI `provider-cli join` (cli/src/main.rs:259-302) → writes provider.toml
→ provider-node register → POST /v1/provider/auth (validateProviderToken) → gateway JWT
→ tunnel dial-out + AUTH/CAPABILITY + optional lease (provider-node tunnel.rs:347-385)
→ heartbeats → /v1/provider/nodes/:id/heartbeat → NATS telemetry.heartbeat → marketplace_watcher → node visible
```
Caveats: lease enforcement optional in compat mode (PN-04); no agent-side availability schedule/consent (PN-03).

## T3 — Proxy listing & marketplace publication ✅

```
/dashboard/provider/nodes ready → /marketplace/create → POST /v1/listings
→ optional sign-offer (/v1/provider/listings/sign-offer; PROVIDER_SIGNATURE_MODE observe|enforce)
→ moderation path (/v1/moderation/listings/*) → status active
→ browse: GET /v1/listings (discovery/query.go; Redis cache 60s) incl. country/ISP/price/latency filters
```
Caveats: missing `(status,country)`/`(status,isp)` indexes (DB-05); no ASN column.

## T4 — Proxy verification (honesty check) ⚠️

- "Verification" = heartbeat liveness + proof-of-proxy policy (`/v1/marketplace/proof-policy`) + provider signatures when enforced. There is **no independent active probe** that measures latency/location/uptime from the platform side; uptime/latency shown in marketplace are node-reported/aggregated, and one public page hardcodes uptime (FE-06).
- **Break:** marketplace trust signals are partially self-reported; an independent verification/oracle probe system is a roadmap item (Phase 5).

## T5 — Buyer wallet funding ✅⚠️

```
/dashboard/wallet → POST /v1/wallet/deposit/crypto {tx_hash}
→ crypto.go:355-483 verifyCryptoDeposit → RPC getTransaction (commitment: CONFIRMED, verify.go:84)
→ treasury credit check + sender==linked wallet
→ CreditSOL + PendingTransaction.reference UNIQUE(txHash) → balance available
```
Caveats: confirmed-not-finalized (BC-07); deposits land in the oracle hot wallet when treasury==oracle (BC-08).

## T6 — Proxy purchase (order + escrow) ✅

```
/marketplace/[id] → BuyListingModal → POST /v1/orders (JWT|API key, orders.go)
→ (Solana path) frontend builds escrow-init tx (apps/web/src/lib/solana.ts) → wallet signs → escrow PDA funded
→ POST /v1/orders/:id/pay/solana → order FSM (docs/adr/0006) → credentials issued
→ GET /v1/orders/:id/credentials → CONNECT endpoint + user/pass (or session intent JWT)
```
Caveats: e2e mock-buy path exists behind env flag (FE-09); `escrowOnChainSkimsPlatformFee=false` drift flag (BE-13).

## T7 — Gateway authentication & entitlement ⚠️

```
Buyer client → CONNECT host:port w/ Proxy-Authorization
→ edge-gateway auth.rs:252-296
  legacy: Redis session:<user> + SHA-256 password hash
  v2: username=intent + session-intent JWT (iss/aud checked; auth/session_intent.rs:64-78)
→ entitlement = pre-provisioned session (limits, node_id pin) — provisioned by control-api at purchase
```
**Break/uncertainty:** no live "did this buyer purchase access to this provider/listing?" check at CONNECT time; entitlement correctness depends on control-api session provisioning being right. Session-intent `max_concurrency`/`requests_per_minute` claims are parsed but **not enforced** (GW-03); shaping cap hardcoded 0 (GW-05).

## T8 — Proxy connection & routing ✅

```
CONNECT accepted (407 if unauth) → policy.rs:152-234 (port allowlist, private-IP literals, hostname denylist)
→ provider_selection.rs:242-350: sticky Redis binding → target_geo shard → pinned node_id → score/ML/random
→ tunnel.rs:138-215: open yamux stream on provider reverse tunnel → send "CONNECT host:port\n" → expect "OK\n"
→ provider-node handler.rs: dial destination; post-DNS reject non-public IPs (227-247, 360-377)
→ bridge_tracked bidirectional copy
```
Caveats: no retry to alternate provider on failure (GW-06); `target_isp` ignored (GW-04); HTTP forward proxy 501 (GW-01); SOCKS4 absent (GW-02).

## T9 — Metering & charging ⚠️

```
bridge_tracked bytes → UsageTracker.record (main.rs:1609-1687)
→ Redis WAL metering:wal:* → 30s batch flush
→ POST /v1/gateway/usage/report {session, bytesUp, bytesDown, nonce=millis, sig=Ed25519}
→ control-api usage.go:38-90 → billing.Aggregator.VerifySignature (FAIL-CLOSED after fix)
→ usage_receipts upsert UNIQUE(session_username, nonce) → Redis pending ledger
→ NATS proxy.settlement.v1.receipts.created → settlement worker → manifests → wallet debit/credit
→ buyer charged, provider earning row (provider_earnings), marketplace fee applied
```
**Breaks/uncertainties:**
- WAS: unverifiable signatures accepted (BE-01) — **fixed**.
- Millis nonce + WAL drain-before-ack → under-report until restart; theoretical double-bill on WAL replay with new nonce (GW-08).
- Failed-connection fairness: billing counts bridged bytes; failed dials produce ~0 bytes → not billed (OK); but CONNECT setup bytes after provider failure may be billed (minor).

## T10 — Session termination ✅

```
DELETE /v1/sessions/:id/terminate (owner) or buyer disconnect
→ session status closed; NATS sessions.terminated → provision worker cleanup
→ Redis session removal → gateway rejects further CONNECT (fail-closed)
```
Caveat: abrupt gateway crash → session revalidation on restart; WAL reload only at restart (GW-08).

## T11 — Refund / dispute ⚠️

```
POST /v1/escrow/:orderId/dispute (buyer) → dispute row; jury path on-chain (dispute_jury.go)
→ admin resolution: POST /v1/admin/disputes/:id/resolve (disputes.go:147+) — authz FIXED (BE-02)
→ escrow release/refund: escrow.go release path → on-chain settle BEFORE DB release when PDA present (escrow.go:162-195)
```
**Breaks:** admin dispute routes mounted on user-JWT group (BE-03); on-chain `ExecuteJuryVerdict` previously allowed arbitrary payout accounts — **fixed in source, redeploy required** (BC-02).

## T12 — Provider payout / withdrawal ✅⚠️

```
Provider earnings accrue (provider_earnings, claimable) → /v1/provider/claim* → wallet credit
→ POST /v1/wallet/withdraw/sol (wallet.go:658+)
→ withdrawal security: linked/whitelisted dest, 24h cooldown, flags freeze, limits, large-amount Ed25519 re-sign, rate limit 5/min, oracle balance preflight
→ LockWalletForUpdate → debit → ledger → oracle.SendSOL (velocity-guarded)
→ on chain failure: compensating credit + compensation outbox (000108)
```
Caveats: oracle hot wallet is the spender (BC-08); velocity/oracle underfund blocks withdraws by design (BE-12).

## T13 — Blockchain settlement ✅ (post-fix)

```
control-api escrow release → oracleClient.SettleEscrow (settlement.go:115+)
→ accounts [oracle, escrowPDA, buyer, seller, program_state] (buildSettleInstruction:262-286)
→ on-chain settle_escrow: authority∈{buyer,seller,admin}; proportional payout
→ NOW: buyer/seller accounts constrained to escrow record (BC-01 fix)
→ watcher/indexer records tx; reconciliation events UNIQUE(source,event_type,escrow_pda,tx_signature)
→ treasury/reconciliation.go compares on-chain treasury vs Σ wallets hourly
```

## T14 — Notifications ⚠️❌

```
domain events → ws hub → NATS proxy.messaging.v1.broadcast → hub consumer → WS clients
Public explorer WS (/v1/explorer/ws) ✅
Authenticated hub /v1/ws ❌ — frontend never sends credentials (FE-01); backend route behind RequireAuth (main.go:493)
```

## T15 — Admin suspension / investigation ⚠️

```
Admin JWT (ADMIN_API_ENABLED) → /v1/admin/users* (suspend), /v1/admin/listings|moderation, /v1/admin/payouts*, escrow reconciliation
```
Breaks: dispute admin (BE-03); admin_extended/system-admin packages unwired (BE-04); audit anomaly endpoints exist (`/v1/audit/*`).

## Summary of Trace Breakpoints

| Flow | Status | Primary gap |
|------|--------|-------------|
| T1 auth | ✅ | — |
| T2 provider onboarding | ✅ | lease optional; no schedule/consent |
| T3 listing | ✅ | index gaps |
| T4 verification | ⚠️ | self-reported trust signals |
| T5 funding | ✅⚠️ | confirmed-only; hot-wallet treasury |
| T6 purchase | ✅ | mock-buy flag hygiene |
| T7 gateway entitlement | ⚠️ | no live purchase check; limits unenforced |
| T8 routing | ✅ | no failover retry; ISP ignored |
| T9 metering/billing | ⚠️ | WAL/nonce (sig soft-accept fixed) |
| T10 termination | ✅ | WAL reload at restart only |
| T11 dispute/refund | ⚠️ | route group; on-chain fix needs redeploy |
| T12 payout | ✅⚠️ | custodial hot wallet |
| T13 settlement | ✅ post-fix | redeploy program |
| T14 notifications | ❌ | /v1/ws auth |
| T15 admin | ⚠️ | dispute group; unwired admin tools |
