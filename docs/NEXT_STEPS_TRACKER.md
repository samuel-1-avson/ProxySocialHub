# Next steps — CI skipped, local / staging focus

GitHub Actions is **out of scope** until you choose to fix billing. Use this tracker instead.

---

## Automated (run on your machine)

```powershell
# One command — wallet + provider automated gates
.\scripts\local-verification.ps1

# Or individually:
.\scripts\wallet-production-closure.ps1
.\scripts\wallet-manual-e2e.ps1
cd services\control-api; go run ./cmd/smoke_wallet_api -base http://localhost:18080
.\scripts\verify-provider-phase1.ps1 -SkipDownload
```

| Check | Script | Local status (dev Docker) |
|-------|--------|---------------------------|
| Migrations 080–088 + schema | `wallet-production-closure.ps1` | **25/25 pass** |
| Public wallet API | same + `wallet-manual-e2e.ps1` | **health, treasury, solana OK** |
| Auth wallet API (synthetic user) | `smoke_wallet_api` | **pass** (deposit needs real SOL; small withdraw may 429 if rate-limited) |
| Provider registry + CLI metadata | `verify-provider-phase1.ps1` | **pass** (gateway link smoke OK) |

---

## Manual only (you in browser / CLI)

**Start here:** [MANUAL_DEVNET_SESSION.md](./MANUAL_DEVNET_SESSION.md) and `.\scripts\manual-devnet-session.ps1`

| # | Task | Doc | Done when |
|---|------|-----|-----------|
| 1 | **Real deposit** — send devnet SOL to treasury, submit tx in Financial HQ | [WALLET_E2E_SMOKE.md](./WALLET_E2E_SMOKE.md) | Balance increases, ledger entry |
| 2 | **Real withdraw** — small then large (+ signature) | same | Tx on Solscan, pending → completed |
| 3 | **Whitelist** — set primary linked address | same | `PUT .../whitelist` |
| 4 | **Oracle funded** — payouts/deposits verify on-chain | [DEV_SOLANA_SMOKE.md](./DEV_SOLANA_SMOKE.md) | `solana health` + oracle balance > fees |
| 5 | **Provider CLI** — token + `node_id` from dashboard, run provider-node 2–3 min | [PROVIDER_PHASE1_VERIFY.md](./PROVIDER_PHASE1_VERIFY.md) | `registry-e2e-check.ps1` shows online + linked |
| 6 | **Provider claim** (optional) | earnings page `ProviderClaimPanel` | Claim prepare/confirm succeeds |
| 7 | **Listings** | `/marketplace/manage` | Create/delete listing works |

Registry rules: [NODE_REGISTRY.md](./NODE_REGISTRY.md) — `provider.toml` **`node_id` = `provider_nodes.id` UUID**.

---

## Staging / production (when you have URLs)

Repeat the same scripts with staging base URL:

Replace `https://api.YOUR-STAGING-HOST` with your real deployed API (not the literal text from docs):

```powershell
$stagingApi = "https://api.staging.proxyhubb.com"   # example only — use yours
.\scripts\local-verification.ps1 -ApiBaseUrl $stagingApi
.\scripts\wallet-manual-e2e.ps1 -ApiBaseUrl $stagingApi -WebBaseUrl "https://staging.proxyhubb.com" -AccessToken $token
```

Note: migration/schema checks in `wallet-production-closure.ps1` still inspect **local Docker postgres** unless you run migrations on staging separately.

Then tick §6 in [WALLET_PRODUCTION_CLOSURE.md](./WALLET_PRODUCTION_CLOSURE.md):

- Migrations on staging DB  
- No Paystack/MoMo in prod env  
- Treasury + oracle funded on target network  
- Manual E2E on staging  
- Monitoring payout retry + circuit breaker  

---

## Product / docs already in repo (uncommitted unless you pushed)

| Item | Location |
|------|----------|
| Seller listings UI | `apps/web/src/app/marketplace/manage/page.tsx` |
| Node registry guide | `docs/NODE_REGISTRY.md` |
| Provider claim | `/dashboard/provider/earnings` |

---

## Deferred

- GitHub Actions / `ci-diagnostic.yml` cleanup  
- CI coverage thresholds  
- Phase 4.6 pay streams  
- Full merge of `nodes` + `provider_nodes` tables  
