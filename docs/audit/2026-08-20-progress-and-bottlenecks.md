# ProxyHubb progress and bottleneck review

**Date:** 2026-08-20
**Scope:** Full local repo audit (tests, build, lint, typecheck) plus live endpoint probes against `api.proxyhubb.com`, `proxyhubb.com`, `docs.proxyhubb.com`, and the buyer gateway `proxy.proxyhubb.com:8090`.
**Branch:** `main` @ `717c064` (with uncommitted local changes from the Chrome Web Store work).

---

## 1. Overall rating

**3.6 / 5 — functional devnet product with real end-to-end proof, held back by a broken web build, a few failing tests, and single-host operations.**

What is genuinely working today:

- A listing created from a Mac provider node is **publicly visible** in the marketplace, with a verified Ed25519 listing offer and an **on-chain listing commitment on Solana devnet** (tx `5KBVU3xoPKRuW9YcSAETZmQaNBDodwMhsohbRFrmt25yThuX24jLnjrESAf4yWCgnCw9b9XsQFXBT9jrmhPERt7k`, slot 485551819, no error).
- The provider is **registered on-chain** (`provider_registered_on_chain: true`, hotkey `5wECCdN12UdwkQXByYh4zLgjrxfisW78tRejxiwmBpbn`).
- The buyer gateway answers **HTTP 407 Proxy Authentication Required** on CONNECT, which is the correct HMAC gate behavior.
- The Chrome extension is **submitted and in compliance review** on the Chrome Web Store (id `icapeackjloaiggfedmfeaoadioiiljn`, Unlisted).
- Core service test suites are mostly green: edge-gateway **192/192**, provider-node **26/26**, CLI **1/1**, extension HMAC/egress/reliability + typecheck all pass.

What drags the score down:

- **`apps/web` does not build** (`next build` fails on a missing module). This is the single worst issue — the shop cannot be rebuilt or redeployed from source right now.
- **3 control-api test failures** (1 real test bug, 1 schema drift, 1 flaky isolation issue).
- **173 ESLint errors** in the web app.
- **Single-host topology**: one server runs control-api, edge, and the only live listing. Not HA, and the honesty docs already say so.
- **Devnet-only settlement** with escrow flows that still need a buyer to complete `initializeEscrow`.

---

## 2. Test and build results

| Component | Command | Result |
|---|---|---|
| apps/extension | `npm test` (hmac, verify, reliability, `tsc --noEmit`) | **PASS** |
| apps/web | `npm run typecheck` | **FAIL** — 4 type errors (see 3.1) |
| apps/web | `next build` | **FAIL** — missing `@/lib/map/load-google-maps` |
| apps/web | contract scripts (provider-config, listing-display, order-status) | **PASS** |
| apps/web | `validate:routes` | **FAIL** — `extensionPrivacy` missing from `ROUTE_POLICIES` |
| apps/web | `eslint` | **173 errors** / 203 warnings |
| services/control-api | `go test ./...` | **3 packages fail** (see 3.2); everything else passes |
| services/control-api | `go vet ./...` | **PASS** |
| services/edge-gateway | `cargo test` | **PASS** (192) |
| services/provider-node | `cargo test` | **PASS** (26) |
| cli | `cargo test` | **PASS** (1) |

Live endpoint probes:

| Endpoint | Status |
|---|---|
| `api.proxyhubb.com/health` | 200 `{"status":"ok"}` |
| `api.proxyhubb.com/api/health` and `/v1/health` | **404** (only `/health` exists — the VM web healthcheck was pointed at `/docs` earlier; same class of mismatch) |
| `proxyhubb.com` + `/api/health` | 200 |
| `proxyhubb.com/privacy/extension` | 200 (CWS privacy URL is live) |
| `docs.proxyhubb.com` + `/docs/api` | 200 |
| `GET /v1/listings` and `/v1/listings/168d8720-…` | 200, `provider_registered_on_chain: true`, offer verified |
| `GET /v1/map/points` | 200, 1 listing pin (Bibiani, GH, region-hub geo) |
| `GET /v1/map/links` | 200, empty (no session topology yet) |
| `GET /v1/nodes`, `/v1/providers`, `/v1/discovery/browse`, `/openapi.json` | **404** (routes do not exist — check docs vs reality) |
| `GET /v1/orders/:id` | 401 (auth required — correct) |
| CONNECT `proxy.proxyhubb.com:8090` no auth | **407** (correct HMAC gate) |
| `api.proxyhubb.com/metrics` | 200, **publicly readable** (see 3.4) |

---

## 3. Issues and bottlenecks, ranked

### 3.1 P0 — `apps/web` does not build

`next build` fails:

```
./src/app/explorer/map/GoogleMaps3DCanvas.tsx:16:8
Type error: Cannot find module '@/lib/map/load-google-maps'
```

`GoogleMaps3DCanvas.tsx` imports `getGoogleMapsApiKey`, `loadGoogleMaps3D`, `loadGoogleMarkerLibrary` from `@/lib/map/load-google-maps`, but that file **does not exist on `main`**. It only exists on the unmerged branch `feat/qa-live-and-cli-jwt-refresh` (commit `190c734`). The canvas component itself is **dead code** — `explorer/map/page.tsx` never imports it — but Next still type-checks it, so the whole shop build is red.

This blocks any normal web redeploy. The live site is currently running an **emergency hand-built image** from the listing-fix deploy, not a clean build.

**Fix (pick one):**
- Delete `apps/web/src/app/explorer/map/GoogleMaps3DCanvas.tsx` (it is unused), or
- Restore `apps/web/src/lib/map/load-google-maps.ts` from commit `190c734` if the 3D map is still wanted.

Other web type errors that fail `npm run typecheck`:

- `src/lib/evm-wallet-provider.tsx` — `wagmi/chains` no longer exports `mainnet`, `polygon`, `polygonAmoy`, `sepolia` (wagmi v2.19 moved chain exports). The EVM provider is optional and lazy-loaded, but it still breaks typecheck.
- `src/lib/extension.ts:66` — `chrome.runtime.sendMessage` callback typed `(response: T)` where the API gives `unknown`.
- `src/lib/navigation/policies.ts` — `ROUTE_POLICIES` is missing the `extensionPrivacy` key that `routes.ts` added for `/privacy/extension`. This is also what fails `validate:routes`.

### 3.2 P1 — control-api failing tests

1. **`internal/middleware` — 4 API-key auth tests fail** (real bug, test-side):
   `api_key_auth_test.go` creates its sqlite fixture with column `rate_limit_per_min`, but the model and the real migration `migrations/000066_security_modernization.up.sql` both use `rate_limit_per_minute`. The test schema drifted from the real schema. One-line fix in the test DDL.

2. **`internal/marketplace` — `TestEnsureSessionCredentialsPlaintext_recoversAfterBeforeUpdateEncrypt` fails** (real bug, test-side):
   The test stubs `CredentialEncryptFn` to return `"cipher:"+plaintext`, so `BeforeSave` stores `ENC:cipher:plain-user`. But `decryptField` base64-validates the payload before calling the stub decryptor, and `cipher:...` is not base64, so decrypt fails and the field is wiped to `""`. The test's fake encryptor must return valid base64 (e.g. `base64(plaintext)`), or `decryptField` should tolerate non-base64 in test mode. The production path (AES-GCM → base64) is fine; this is a test-fidelity bug.

3. **`internal/api` — `TestGetMapLinks_EmptyDB` fails in full runs, passes alone** (test isolation):
   The test assumes `db.DB == nil`, but another test in the package leaves a global `db.DB` pointing at a dead miniredis/sqlite, so `topology.ListLinks` errors and the handler returns 500 instead of the expected empty 200. Needs `db.DB = nil` setup/teardown in this test. Not a production bug.

### 3.3 P1 — web lint debt

173 ESLint errors. By rule: `@typescript-eslint/no-explicit-any` **109**, `react-hooks/set-state-in-effect` **29**, `react/no-unescaped-entities` **13**, `react-hooks/refs` **11**, plus a handful of hooks rules. Hotspots: `explorer/nodes/page.tsx`, `explorer/page.tsx`, `GoogleProxyMapCanvas.tsx`, `lib/solana.ts`, `explorer/leaderboard/page.tsx`, `lib/auth.tsx`.

None of these are individually fatal, but the `react-hooks/*` family (44 errors) is where real bugs hide — stale closures, cascading renders, and effect loops. Worth a dedicated cleanup pass before the next web feature.

### 3.4 P2 — security and privacy surface

- **`/metrics` is publicly readable** on `api.proxyhubb.com` (107 KB of Prometheus data, no auth). It exposes internal label values, request rates, and operational detail. Put it behind the private overlay or an auth check.
- **Session credentials are encrypted at rest** (`ENC:` prefix, AES-GCM) with the BeforeSave/AfterFind hook pair — good. The `ensureSessionCredentialsPlaintext` recovery path exists for partial updates — good. Keep `PROXYHUB_SESSION_CAPABILITY_SIGNING_KEY` and the slash envs (`PROXYHUB_GATEWAY_SLASH_AUTO`, `PROXYHUB_GATEWAY_SLASH_CONFIRM`) unset as they are now.
- **Extension secrets stay in `chrome.storage.session`** — good. No sync storage. CWS privacy answers match the code.
- The extension manifest requests `<all_urls>` + `proxy` — justified for 407 auth, but it is the reason CWS review will be slow. Do not add more permissions.

### 3.5 P2 — marketplace and escrow flow gaps

- Order `edd30b39-…` is still **`pending_payment`**: `initializeEscrow` never landed on devnet. Buyer must be on Phantom **Devnet** with test SOL, and the buyer cannot be the seller (same account is rejected). Until a buy completes end-to-end, escrow → session activation → HMAC credentials → CONNECT is only proven piecewise.
- **Listing quality data is placeholder-grade**: the live listing shows `uptime_percent: 100`, `quality_score: 100`, `avg_latency_ms: 0`, country "Verified Region", ISP "Verified High-Performance Provider", geo "region_hub (approx.)". Fine for testnet, but buyers will read these as real. Label or compute them before any public launch.
- **Seller object in the public listing payload is zero-valued** (`created_at: 0001-01-01`, empty email, `is_online: false`). Looks broken to anyone inspecting the API.
- **Mac provider goes offline when the lid closes** — the node only heartbeats while `provider-node start` runs with the lid open. One offline Mac = zero inventory. This is the biggest supply-side bottleneck.

### 3.6 P2 — operations and topology

- **Single host**: control-api, edge-a, Redis, and Postgres all live on one GCE box (`proxyhubb-testnet`). Docs already state "not HA". Any bad recreate takes the whole marketplace down. The runbooks (never `--remove-orphans`, never recreate `edge-a`, all overlays) exist because of past close calls — keep following them.
- **Emergency web image on the VM is not in GHCR**: the next `gcp-deploy-web.sh` pull will overwrite the live listing-fix/privacy build. Rebuild web properly (after fixing 3.1) and push a tagged image so the live state is reproducible.
- **VM web healthcheck was `/docs`** (copy-paste from the docs service); it is patched to `/api/health` now, but note the API itself only serves `/health` — `/api/health` and `/v1/health` on `api.proxyhubb.com` 404. Align healthcheck paths across services.
- **API surface vs docs**: `/v1/nodes`, `/v1/providers`, `/v1/discovery/browse`, `/openapi.json` all 404 while docs reference similar paths. Either add the routes or fix the docs; the OpenAPI spec should be served somewhere public since docs.proxyhubb.com renders it.

### 3.7 P3 — smaller items

- `apps/web/test-deposit.js` is a stray CommonJS file at `src/` root that ESLint flags; move it under `scripts/` or delete it.
- `wagmi`/`viem`/`@polkadot/*`/`@moonpay/*` are heavy dependencies for a Solana-first shop; the EVM provider is disabled by env but still shipped. Consider pruning.
- CLI crate version is `1.0.5` while the live provider binary is `1.0.6` — version drift between repo and releases.
- Extension `manifest.json` still lists `localhost` host permissions in the repo copy (stripped only in the store build). Fine, but keep the store build the only thing uploaded.
- 3 TODO/FIXME markers in the codebase (`badges.go`, `pricing/oracle.rs`, `ErrorBoundary.tsx`) — low urgency.

---

## 4. What to fix first (suggested order)

1. **Make `apps/web` build again** — delete or satisfy the `load-google-maps` import, fix `extensionPrivacy` route policy, fix the wagmi chain imports and the `extension.ts` callback type. Then rebuild, tag, and push a proper web image so the live shop is reproducible.
2. **Fix the 3 control-api test failures** — test-schema column name, base64 in the fake encryptor, `db.DB` teardown in the map-links test. Small diffs, high signal.
3. **Complete one full buy on devnet** — Phantom Devnet, approve `initializeEscrow`, confirm session activation and HMAC CONNECT through the extension. This is the last unproven link in the core loop.
4. **Lock down `/metrics`** and align healthcheck paths.
5. **Keep the Mac awake** (or add a second provider) so inventory does not vanish when the lid closes.
6. **Lint cleanup pass** on the `react-hooks` errors in the explorer pages.
7. **After CWS approval**: set `NEXT_PUBLIC_EXTENSION_CWS_URL` and `NEXT_PUBLIC_EXTENSION_ID`, then do a web-only deploy (no `edge-a` recreate).

---

## 5. Chrome Web Store status

- Item `icapeackjloaiggfedmfeaoadioiiljn` is **submitted and in compliance review** (Unlisted, all regions, Free).
- All required assets were supplied: 128×128 icon (stacked wordmark), 1280×800 screenshot, 440×280 promo tile, 1400×560 marquee, privacy URL `https://proxyhubb.com/privacy/extension` (live, 200), single-purpose statement, per-permission justifications, data-use disclosure (PII + authentication only), remote code = No, test instructions with no username/password.
- Expect days, not hours, because of `<all_urls>` + `proxy`. Do not unpublish or resubmit while it is in review.

---

## 6. Repo-map addendum (structural findings)

From a full repo sweep after the report above:

- **`services/solana-programs/proxyhub/programs/session` must never be deployed** — its `slash_gateway` is an unconstrained admin transfer. Bonded slash lives in `programs/gateway-bond` instead. Keep it out of every deploy path.
- **NATS auth is still an open TODO** (SEC-07 in `docs/audit/13_SECURITY_AND_PRIVACY_AUDIT.md`). Internal-only on the single host today, but it must be authenticated before any second host joins.
- **Dead CI job**: `.github/workflows/proxyhubb-ci.yml` still has a `packages/contracts` Hardhat job, but there is no `packages/` directory. It also runs `npm test -- --coverage` for web, and **web has no `test` script** — both are dead weight or silent skips in CI.
- **Prior audit pack already exists** at `docs/audit/00`–`22` (executive summary, architecture map, security/privacy audit). This report complements it; read `00_EXECUTIVE_SUMMARY.md` for the older baseline.
- **Workstation key-material risk** noted in prior audits: `treasury-keypair.json`, `jwt.txt` are gitignored but may still sit on disk. Verify they are not anywhere near the repo before any commit.
- **Relayer service is decommissioned** (`services/relayer` exits immediately) — safe to ignore or remove.
- **zk-prover / groth16-prover have no test files** — provers are soak-verified only (see `docs/ops/evidence/BC11_*`).
