# 09 — Buyer Marketplace Audit

## 1. Buyer Journey Verification

| Step | Verdict | Evidence / gap |
|------|---------|----------------|
| Discover proxies (browse/search/filter/map) | ✅ real | `/v1/listings` + facets + `/v1/marketplace/map`; filters: country, city, ISP (ILIKE), protocol, price, latency, uptime, reputation; Redis-cached |
| Filter accuracy | ⚠️ | Works, but ISP uses substring ILIKE without index; no ASN filter (no column); latency sort unindexed (DB-05) |
| Trustworthy stats before purchase | ⚠️ | Uptime/latency are node-reported aggregates; provider public page hardcodes 99.8% (FE-06); no independent probing (T4) |
| Verify availability | ⚠️ | "Online" = heartbeat freshness; a node can show online yet fail CONNECT (no pre-purchase probe) |
| Purchase (pay-as-you-go / listing buy / subscription / B2B pools) | ✅ | `/v1/orders` (JWT or scoped API key), on-chain escrow init via wallet, `/v1/subscriptions*`, `/v1/bulk/pools*` |
| Receive credentials | ✅ | `/v1/orders/:id/credentials` (CONNECT endpoint + user/pass or session-intent JWT) |
| Connect through gateway | ✅ CONNECT / WS / SOCKS5(opt) | ❌ plain HTTP proxy (501), SOCKS4 |
| Sticky sessions | ✅ | Redis sticky binding (`provider_selection.rs`) |
| Rotate sessions | ✅ | rotation module for non-sticky sessions |
| Geographic selection | ✅ | `target_geo` shard keys |
| ISP selection | ❌ advertised, not routed | `target_isp` never used (GW-04) |
| Monitor bandwidth/charges | ✅ | `/v1/usage/me`, `/v1/usage/session/:id`, dashboard usage pages |
| Stop usage | ✅ | session terminate; gateway fail-closed on Redis session removal |
| Report failure / dispute | ✅⚠️ | `/v1/disputes*`; admin resolution authz fixed; route placement pending (BE-03) |
| Refunds | ✅⚠️ | escrow release path settles on-chain before DB release; jury path on-chain (payout binding fixed, redeploy pending) |
| Support tickets / reviews | ✅ | forum/messaging + `/v1/sessions/:id/review` |

## 2. Abuse / Correctness Scenarios

| Scenario | Result |
|----------|--------|
| Payment succeeds but no access | Order FSM issues credentials only after payment/escrow confirmation; dev `activate-dev` gated by env (now default-off) |
| Access without payment | Gateway auth requires provisioned session/JWT — no route found to mint sessions without order |
| Proxy shown online but unusable | Possible (heartbeat ≠ successful CONNECT); no compensating automatic refund for failed dials — flagged as product gap (fairness: failed dials bill ~0 bytes) |
| Buyer exceeds purchased limits | **Possible** — session `max_concurrency`/RPM unenforced (GW-03); shaper cap 0 (GW-05); spending enforced at revalidation/flush, not live |
| Double-charge | Server dedup `(session, nonce)` + ledger uniques; residual window via millis-nonce WAL replay (GW-08) |
| Credential sharing between buyers | Possible technically (Basic creds work anywhere); no per-IP binding detected — accepted marketplace norm, but document policy |
| Expired subscription still works | Session intents carry expiry in JWT; Redis sessions have TTL — OK |
| Cancelled purchase keeps working | Terminate removes Redis session → fail-closed — OK |
| Provider failure billed | Dial failures bill ~0 bytes; mid-session provider drop bills transferred bytes only (fair) |

## 3. Buyer-facing Findings

| ID | Finding | Severity |
|----|---------|----------|
| BUY-01 | ISP targeting advertised but not routed (GW-04) | Medium |
| BUY-02 | Purchased concurrency/RPM caps not enforced at gateway (GW-03) | Medium |
| BUY-03 | No live bandwidth cap — burst overspend until flush (GW-05) | Medium |
| BUY-04 | No automatic credit for verified-failed sessions (product decision needed) | Low-Med |
| BUY-05 | HTTP forward-proxy clients unsupported (501) — docs must state CONNECT-only | Medium |
| BUY-06 | Pre-purchase stats are self-reported; one page hardcoded (FE-06) | Medium |
| BUY-07 | Credential sharing not constrained (policy decision) | Low |

## 4. Verdict

Buyers can genuinely discover, purchase, and use provider proxies via CONNECT today. The marketplace is honest about routing *geography* but over-promises on *ISP targeting* and *enforced limits*, and trust statistics need independent measurement before they should influence price.
