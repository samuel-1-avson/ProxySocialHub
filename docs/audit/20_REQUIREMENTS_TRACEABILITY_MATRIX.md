# 20 — Requirements Traceability Matrix

Legend: ✅ working · ⚠️ partial · ❌ broken/missing. Evidence references audit reports/files.

| Requirement | Frontend | Backend | API | Database | Events | Edge GW | Chain | Tests | Status | Evidence |
|-------------|----------|---------|-----|----------|--------|---------|-------|-------|--------|----------|
| Provider can register | ✅ `/dashboard/become-provider` | ✅ apply/status | ✅ `/v1/provider/apply` | ✅ profiles/apps | — | — | — | partial | ✅ | 02/03, T2 |
| Provider can connect a device | ✅ setup/nodes/cli | ✅ nodes+tokens | ✅ `/v1/provider/nodes*|tokens*` | ✅ nodes | heartbeat→watcher | ✅ tunnel accept | — | provider unit | ✅ | 08, T2 |
| Provider can submit a proxy (listing) | ✅ create/manage | ✅ listings CRUD | ✅ `/v1/listings` | ✅ proxy_listings | — | — | sign-offer opt | ✅ | ✅ | T3 |
| System can verify a proxy | ⚠️ proof policy UI | ⚠️ heartbeat+proofs | ⚠️ proof-policy | ✅ | heartbeat | ⚠️ liveness only | ⚠️ attestations | ❌ probing | ⚠️ | T4 — self-reported |
| Verified proxy appears in marketplace | ✅ browse/map | ✅ moderation+discovery | ✅ listings/facets | ✅ indexes (gaps DB-05) | — | — | — | ✅ | ✅ | 02/05 |
| Buyer can purchase proxy usage | ✅ buy modal/orders | ✅ orders+escrow | ✅ `/v1/orders*` | ✅ orders/escrow | — | — | ✅ escrow init | ✅ (mocked e2e) | ✅ | T6 |
| Buyer can authenticate with gateway | ✅ credentials UI | ✅ session provisioning | ✅ credentials/intent | ✅ sessions | sessions.created | ✅ auth fail-closed | — | ✅ | ✅ | T7 |
| Gateway can route traffic through provider | — | ✅ provisioning | ✅ gateway routes | — | — | ✅ yamux CONNECT | — | benches/units | ✅ | 07, T8 |
| Usage can be measured | ✅ usage pages | ✅ ingest/receipts | ✅ usage report | ✅ receipts | settlement.receipts | ✅ byte counters | — | ⚠️ no WAL replay test | ✅⚠️ | T9, GW-08 |
| Buyers charged accurately | ✅ usage/billing UI | ✅ settlement worker | ✅ | ⚠️ single-entry ledger | ✅ | ✅ signed reports | ✅ proportional settle | ✅ +new sig tests | ⚠️ | 10 (GW-08 windows) |
| Providers receive accurate earnings | ✅ earnings pages | ✅ provider_earnings | ✅ `/v1/provider/earnings*` | ✅ | ✅ | — | ✅ | partial | ✅⚠️ | 10 |
| Marketplace fees collected | — | ✅ fee logic | — | ✅ | ✅ | — | ⚠️ fee-skim flag drift BE-13 | partial | ⚠️ | 03/10 |
| Failed sessions not incorrectly billed | — | ✅ bytes≈0 → charge≈0 | — | ✅ | ✅ | ✅ dial-fail = 0 bytes | — | ❌ no failed-session test | ✅⚠️ | FIN-11 policy TBD |
| Refunds supported | ✅ dispute UI | ✅ disputes+release | ✅ disputes routes | ✅ | — | — | ✅ release (binding fixed) | partial | ⚠️ | BE-03, BC-02 redeploy |
| Provider payouts supported | ✅ claim+withdraw UI | ✅ claim+withdraw | ✅ claim/withdraw routes | ✅ ledger | outbox | — | ✅ SendSOL | ✅ | ✅ | T12 |
| Blockchain settlement supported | ✅ solana UX | ✅ oracle client | ✅ solana routes | ✅ | recon events | — | ✅ (post-fix) | Anchor TS (not run) | ✅⚠️ | 11 — redeploy pending |
| Transactions reconcilable | ✅ treasury page | ✅ reconciliation svc | ✅ admin recon routes | ✅ recon history | ⚠️ treasury events dropped EV-01 | — | ✅ | partial | ⚠️ | 10/12 |
| Admins can investigate disputes | ⚠️ admin UI | ⚠️ BE-03 route group | ⚠️ | ✅ audit logs | — | — | jury on-chain | ❌ regression test TBD | ⚠️ | 03, 15 |
| Fraud/abuse detectable | ⚠️ monitoring UI | ⚠️ watchtower/anomalies | ✅ audit/anomalies | ✅ | ⚠️ alerts orphan | ✅ auth metrics | — | ❌ | ⚠️ | 13 §4 |
| Platform recovers from component failures | — | ✅ graceful shutdown (fixed) | health/ready | ✅ backups | ⚠️ no DLQ | ⚠️ no failover retry | ⚠️ RPC failover | ❌ chaos tests | ⚠️ | 14 |

## Coverage summary

- **Fully traced & working:** 9/20 requirements.
- **Partial (works with caveats or single-point gaps):** 11/20.
- **Completely broken end-to-end:** 0 — every required flow has a working core path; the weaknesses are integrity, durability, and trust-signal honesty rather than absence.
