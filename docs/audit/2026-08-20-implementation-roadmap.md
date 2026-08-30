# Implementation roadmap — 2026-08-20 audit findings

Source: `docs/audit/2026-08-20-progress-and-bottlenecks.md` (score 3.6/5). This plan sequences only the issues found in that audit. Older strategic items live in `docs/audit/19_IMPLEMENTATION_ROADMAP.md`; this document does not replace it.

Complexity: **S** < half day · **M** < 2 days · **L** multi-day. Every item lists its acceptance check.

---

## Phase A — Unblock the web build (do first, everything else deploys through this)

The live shop is an emergency hand-built image. Until `next build` is green locally, no web fix can ship safely and the next `gcp-deploy-web.sh` pull will wipe the live listing/privacy fixes.

| # | Item | Component | Complexity | Acceptance |
|---|------|-----------|-----------|------------|
| A.1 | Delete `apps/web/src/app/explorer/map/GoogleMaps3DCanvas.tsx` (dead code — `explorer/map/page.tsx` never imports it), **or** restore `apps/web/src/lib/map/load-google-maps.ts` from commit `190c734` if the 3D map is still wanted | web | S | `next build` passes the type stage |
| A.2 | Add `extensionPrivacy: "public"` to `ROUTE_POLICIES` in `apps/web/src/lib/navigation/policies.ts` | web | S | `npm run validate:routes` passes |
| A.3 | Fix wagmi chain imports in `apps/web/src/lib/evm-wallet-provider.tsx` (wagmi v2.19 moved `mainnet`/`polygon`/`polygonAmoy`/`sepolia` exports — import from `viem/chains` or the new wagmi path) | web | S | `npm run typecheck` has no wagmi errors |
| A.4 | Fix `chrome.runtime.sendMessage` callback typing in `apps/web/src/lib/extension.ts:66` (`response: unknown` narrowed to `T`) | web | S | `npm run typecheck` fully green |
| A.5 | Full clean build + push a tagged image to GHCR; web-only deploy (no `edge-a` recreate, all overlays) | web/ops | M | Live shop runs a reproducible tagged image; `/privacy/extension` and listing-create still work on live |

**Exit:** `npm run typecheck`, `validate:routes`, and `next build` all green; live web on a tagged GHCR image.

---

## Phase B — Green test suites (confidence floor before touching money paths)

| # | Item | Component | Complexity | Acceptance |
|---|------|-----------|-----------|------------|
| B.1 | Fix test DDL column `rate_limit_per_min` → `rate_limit_per_minute` in `services/control-api/internal/middleware/api_key_auth_test.go` to match `migrations/000066_security_modernization.up.sql` | control-api | S | 4 `TestRequireAuthOrAPIKey_*` pass |
| B.2 | Make the fake encryptor in `TestEnsureSessionCredentialsPlaintext_recoversAfterBeforeUpdateEncrypt` return valid base64 (e.g. `base64(plaintext)`) so `decryptField` accepts it | control-api | S | test passes; production AES-GCM path untouched |
| B.3 | Fix test isolation for `TestGetMapLinks_EmptyDB`: save/restore global `db.DB` (set nil in setup) in `internal/api/map_topology_test.go` | control-api | S | `go test ./internal/api/` green in full-package runs, not just alone |
| B.4 | Add the three packages to a CI gate so they cannot silently rot again | control-api/CI | S | `go test ./internal/middleware/ ./internal/marketplace/ ./internal/api/` in CI, no continue-on-error |

**Exit:** `go test ./...` in `services/control-api` fully green.

---

## Phase C — Prove the money loop end-to-end (the last unproven link)

| # | Item | Component | Complexity | Acceptance |
|---|------|-----------|-----------|------------|
| C.1 | Complete one real devnet buy: Phantom on **Devnet**, buyer ≠ seller, approve `initializeEscrow` for order `edd30b39-…` (or a fresh order on listing `168d8720-…`) | web/chain | S | order leaves `pending_payment`; escrow PDA funded on devnet |
| C.2 | Verify session activation → HMAC credentials → extension CONNECT → `Check IP` shows the proxy egress | full stack | S | extension shows Healthy with a non-baseline IP; `Turn off` restores direct |
| C.3 | Exercise the failure paths while it is fresh: buyer = seller rejected, wrong-network wallet rejected, escrow timeout reconciles | control-api | S | each failure gives a clean user-facing error, no stuck `pending_payment` |
| C.4 | Record the run as evidence under `docs/ops/evidence/` (same convention as W9/W10/W11 soaks) | docs | S | evidence file committed with tx signatures |

**Exit:** buy → escrow → activate → CONNECT → off is proven on live devnet, with evidence on disk.

---

## Phase D — Security surface (small, high-value)

| # | Item | Component | Complexity | Acceptance |
|---|------|-----------|-----------|------------|
| D.1 | Put `/metrics` behind auth or the private overlay on `api.proxyhubb.com` (currently 200, ~107 KB of Prometheus labels, no auth) | control-api/ops | S | unauthenticated GET → 401/404; Grafana still scrapes |
| D.2 | Align healthcheck paths: API serves only `/health`; web serves `/api/health`. Pick one convention, fix VM healthchecks and docs | ops | S | no healthcheck points at a 404 |
| D.3 | Serve the OpenAPI spec (`/openapi.json` or redirect to docs) and either add or doc-drop the 404 routes (`/v1/nodes`, `/v1/providers`, `/v1/discovery/browse`) | control-api/docs | S | docs site and API agree; spec reachable |
| D.4 | Confirm `treasury-keypair.json` / `jwt.txt` are not on disk anywhere near the repo (prior-audit flag); keep slash envs and capability signing key unset | ops | S | verified absent; documented |
| D.5 | NATS authentication (SEC-07 carry-over) — required before any second host joins | infra | M | unauthenticated NATS connect fails |

**Exit:** no unauthenticated operational surface; docs match the live API.

---

## Phase E — Supply side and inventory honesty

| # | Item | Component | Complexity | Acceptance |
|---|------|-----------|-----------|------------|
| E.1 | Keep the Mac provider alive: lid-open `provider-node start`, or move the node to an always-on box/VPS. One offline Mac = zero inventory | provider/ops | S | heartbeat gap < interval across 24 h |
| E.2 | Label or compute placeholder quality fields on listings (`uptime 100`, `quality_score 100`, `latency 0`, "Verified Region", "Verified High-Performance Provider", region-hub geo) before any public launch | control-api/web | M | public listing payload shows measured values or honest "unmeasured" labels |
| E.3 | Fix the zero-valued seller object in the public listing payload (`created_at: 0001-01-01`, empty fields, `is_online: false`) | control-api | S | seller block populated or omitted |
| E.4 | Onboard a second provider node (any always-on machine) so inventory survives one offline device | provider/ops | M | 2+ pins on `/v1/map/points`; browse stays populated with one node down |

**Exit:** inventory does not vanish when one laptop closes; public numbers are honest.

---

## Phase F — Code-health debt (schedule after A–C, do not let it block them)

| # | Item | Component | Complexity | Acceptance |
|---|------|-----------|-----------|------------|
| F.1 | `react-hooks/*` cleanup (44 errors: `set-state-in-effect`, `refs`, `rules-of-hooks`, `purity`) — hotspots: `explorer/nodes/page.tsx`, `explorer/page.tsx`, `GoogleProxyMapCanvas.tsx`, `lib/auth.tsx`, `useExplorerWS.ts` | web | M | hooks errors = 0 |
| F.2 | `no-explicit-any` pass (109 errors) — start with `lib/solana.ts`, explorer pages | web | M | any-count near 0 in touched files |
| F.3 | Move or delete `apps/web/test-deposit.js` (stray CommonJS in `src/`) | web | S | lint clean for that file |
| F.4 | Prune or lazy-isolate unused wallet stacks (`wagmi`/`viem`/`@polkadot/*`/`@moonpay/*`) — EVM provider is env-disabled but still shipped | web | M | bundle analyzer shows reduction; typecheck still green |
| F.5 | Version drift: CLI crate `1.0.5` vs live provider `1.0.6` — align and document the release source of truth | cli/ops | S | versions match or drift is documented |
| F.6 | CI cleanup: remove dead `packages/contracts` Hardhat job; fix the web `npm test --coverage` step (no `test` script exists) | CI | S | CI has no dead jobs |
| F.7 | Optional: add tests for `zk-prover` / `groth16-prover` (currently soak-verified only) | provers | L | unit coverage on prover inputs |

---

## Phase G — Chrome Web Store follow-through (blocked on Google)

| # | Item | Component | Complexity | Acceptance |
|---|------|-----------|-----------|------------|
| G.1 | Wait for review of item `icapeackjloaiggfedmfeaoadioiiljn`. Do not unpublish or resubmit | — | — | status leaves "In review" |
| G.2 | On approval: set `NEXT_PUBLIC_EXTENSION_CWS_URL` + `NEXT_PUBLIC_EXTENSION_ID`, web-only deploy (after Phase A) | web/ops | S | shop links the real store listing |
| G.3 | If rejected: answer with the permission justifications in `docs/product/EXTENSION_CWS.md`; do not add history/cookies/page-content permissions | — | S | resubmission addresses only what reviewers cited |

---

## Sequencing notes

- **A before everything.** Every later web change ships through the build A restores.
- **B before C.** The escrow/activation path touches the exact packages with failing tests; fix the floor first.
- **C is the product.** Everything else is hygiene until a buy completes end-to-end.
- **D.1 is the only security item with a live public exposure** — do it any time, it is small.
- **E.1 is free and immediate** (keep the Mac awake); E.4 is the real fix.
- **F is explicitly not urgent.** Do not let lint debt delay the money loop.
- **G waits on Google** — days, because of `<all_urls>` + `proxy`.

## Definition of done for this roadmap

1. `next build`, `npm run typecheck`, `validate:routes` green; live web on a tagged GHCR image.
2. `go test ./...` green across control-api; the three fixed tests gated in CI.
3. One devnet buy completed through escrow to a working extension CONNECT session, evidence committed.
4. `/metrics` not public; healthchecks and docs match the live API.
5. Inventory survives a single provider going offline; public listing numbers are honest.
