# ProxyHubb Regional Auditor

An AI assistant that checks how a website you are authorized to test behaves
through different **regional ProxyHubb networks**, and produces an
evidence-backed report you can inspect, rerun after a fix, and export.

> **Read this first: two completion states, reported separately**
>
> | | State |
> | --- | --- |
> | **Core feature (fixture + replay + real Meta analysis)** | **Complete and verified locally** (details in [§11](#11-checks-actually-run)). |
> | **Live acceptance** (new captures through two real ProxyHubb regional exits) | **One region done, two not yet.** On 2026-11-02 audit `aud_a397dd463c47` captured `https://proxyhubb.com/` through the user's own Ghana marketplace order on the testnet gateway, with a verified exit and a real Meta analysis ([§13.0](#130-first-real-live-audit-2026-11-02)). A two-region comparison still needs an active order in a second country. |

The audit is **read-only**: it never logs in, submits forms, buys anything or
changes state on the audited site.

---

## 1. What a user gets

1. Enter an HTTPS site, pick up to two regions, and describe what should be true
   (*"Check that signup is usable and that the expected currency is displayed for
   customers in Ghana and the US."*).
2. The worker opens one **isolated Chromium per region**, forced through that
   region's ProxyHubb session, and **observes the exit IP from the same browser**
   before and after loading your site.
3. It captures screenshots, sanitized visible text, request failures, console
   errors, controlled check results and browser timings, with provenance.
4. Meta's model writes findings from that evidence. Every finding is validated
   against the evidence that was actually captured; unsupported claims are
   removed and the removals are shown.
5. Results show the regions side by side. After you fix the site, **Rerun and
   compare** shows what was resolved, what persists, what is new and what cannot
   be compared. Export as sanitized JSON or a self-contained HTML report.

Target user: a small developer or QA team that cannot easily observe its site
from its customers' networks.

## 2. Status checklist

| Area | Status | Evidence |
| --- | --- | --- |
| Honest proxy verification (`/api/proxy/test`) | Done | GET now says "API reachable, proxy not tested"; authenticated POST sends a real CONNECT + TLS request; 6 offline tests + a manual run against a real TLS echo service |
| No silent country substitution | Done | Exit observed per region; mismatch / unknown / bypass / unavailable are never interpreted; tested end to end ([§5](#5-how-a-region-is-verified)) |
| Bounded browser worker, persistent jobs, evidence | Done | queue + concurrency caps, per-job time limit, cancel, abandoned-job recovery, filesystem and PostgreSQL stores |
| Real Meta Model API integration | Done, verified live | plan stage + vision analysis on real screenshots; strict JSON schema; failure states ([§7](#7-meta-ai-integration)) |
| Authenticated Audits UI | Done | an **Audits tab in Connections** (`/app/connections?tab=audits`; `/app/audits` redirects there), a **card on each active order** and a shortcut on each access card that opens the audit in a dialog, and report pages at `/app/audits/[id]`; 25 mocked-API browser tests incl. WCAG A/AA scan, keyboard, mobile |
| Rerun comparison, export | Done | resolved / persisting / new / incomparable; JSON + HTML |
| Fixture + replay modes, clearly labelled | Done | provenance banner on every page and export; replay keeps original capture timestamps |
| Redirect restrictions | **Detect-only in the worker**; prevention is gateway-side and opt-in | first hops are blocked before they are sent; redirect hops cannot be, so they are detected, stopped, discarded and reported ([§9](#9-security-and-network-boundaries)) |
| Evaluation | Done on a synthetic suite | 15 labelled cases, real model, 4 passes ([§12](#12-evaluation)) |
| Live transport (HTTP CONNECT + TLS) | Verified against a **local simulation** of the gateway | Chromium answers the `407` Basic challenge, tunnels HTTPS with a real certificate, probes its exit over HTTPS, never loads the site through a wrong-country exit, and a gateway allow-list refuses a redirect host before it connects (5 tests, `test/livepath.test.ts`). Not a real gateway or a real session |
| Live-readiness tooling | Done | `npm run preflight` checks every live prerequisite by variable name (passes against the real testnet today); `npm run stack` starts worker + web with a fresh secret |
| Retention | Done | finished audits and their screenshots are deleted after `AUDITOR_RETENTION_DAYS` (default 30); unfinished audits never are |
| Deployable demo site for live demos | Prepared, **not deployed** | `demo-site/` Cloudflare Worker, same renderer as the fixture, byte-for-byte parity tested |
| PostgreSQL store and migration | Done | verified on a real **PostgreSQL 14.24** (embedded, scratch install): migration applies and is idempotent, CHECK constraints reject bad rows, store contract 7/7, down then up works. Docker cannot run on this machine, so it is skipped in the default `npm test` unless `AUDITOR_TEST_DATABASE_URL` is set |
| Control-API / gateway changes | None made | see [§5.2](#52-gateway-behaviour-i-checked-and-did-not-change) |
| Live capture through two real exits | **Blocked** | [§13](#13-outstanding-live-prerequisites) |

## 3. What is new, and what already existed

This feature was built on top of an existing platform (marketplace, control API,
edge gateway, provider network, SDKs, web workspace, design system). It did not
rebuild any of those.

**Reused as-is:** `POST /v1/sessions/intent` (sticky, `target_geo`), the marketplace
order reads `GET /v1/orders`, `GET /v1/orders/{id}` and `GET /v1/orders/{id}/credentials`
(the "use my funded orders" source, §10.2a), the buyer
gateway's HTTP CONNECT contract, `GET /v1/listings/facets`, the JWT/`/v1/auth/me`
trust model from `middleware.ts`, the workspace shell, `ui-*` design tokens,
React Query provider, `Modal`, Playwright signed-auth fixtures.

**New (all untracked or modified in the working tree; nothing was committed):**

| Path | Purpose |
| --- | --- |
| `services/regional-auditor/` | the worker: browser capture, policy, assurance, Meta client, stores, runner, internal API, fixtures, evaluation, tests |
| `apps/web/src/app/api/audits/**` | authenticated route handlers (BFF) |
| `apps/web/src/lib/server/` | server-only helpers: auth, signed worker calls, session minting, proxy probe |
| `apps/web/src/lib/api/audits.ts`, `apps/web/src/modules/audits/` , `apps/web/src/app/app/audits/` | client API + UI |
| `packages/design-system/audits.css` | token-only styles |
| `migrations/000176_regional_audits.{up,down}.sql` | job table |
| `apps/web/e2e/audits*.spec.ts`, `apps/web/scripts/{proxy-probe,audit-bff,audit-orders}.test.mjs` | tests |
| `docs/hackathon/REGIONAL_AUDITOR.md`, `docs/hackathon/eval-results/`, `docs/hackathon/screenshots/` | this file, raw evaluation results, screenshots from the full-stack run (real UI, synthetic fixture evidence, real model) |

**Modified existing files (small, intentional):** `apps/web/src/app/api/proxy/test/route.ts`
(rewritten, see §4), `apps/web/src/app/dashboard/proxy/page.tsx` (stops claiming
"Synchronized"), `apps/web/src/lib/navigation/{routes,policies,workspace}.ts`
(registers the audit routes; `workspace.ts` only adds `/app/audits` to the legacy paths of the
existing **Connections** destination, so the workspace keeps its four destinations),
`apps/web/src/modules/workspace/Connections.tsx` (an Audits tab and a per-order shortcut),
`apps/web/src/components/marketplace/MarketplaceOrderDetailView.tsx` (the audit card on an
active order), `apps/web/src/app/globals.css` (one import), `apps/web/.env.example`.

**Pre-existing uncommitted work that this feature did not touch:**
`.github/workflows/deploy.yml` (modified before this work), `scripts/settlement-acceptance/`
(untracked before), and the brief itself (`docs/plans/META_HACKATHON_REGIONAL_AUDITOR_EXECUTION_PROMPT_2026-11-01.md`).
The branch (`codex/frontend-plan-completion`) already carried one commit ahead of `main`.

Reproduce this manifest from Git evidence: `git status --short` and
`git diff --stat`. The platform itself (wallet, escrow, settlement, social,
governance, agent marketplace, provider app) predates this event.

## 4. Known gap A: `/api/proxy/test` claimed more than it tested

It returned "Proxy gateway is operational" whenever the control API's `/health`
answered, and the Connect page then displayed "Synchronized, minimal jitter
detected". No request ever touched the gateway or a provider.

Now:

* **`GET /api/proxy/test`** (anonymous): `status: "api_reachable"`,
  `proxy_verified: false`, and a message that no session was used. HTTP 200 when
  reachable and 503 when not, so existing callers that only check `response.ok`
  keep working; the Connect page now reads the body.
* **`POST /api/proxy/test`** (bearer token required, 4 s rate limit): opens an
  HTTP CONNECT tunnel through the gateway with the caller's own session-intent
  token, performs a **certificate-verified** TLS handshake with a fixed echo URL
  (server configuration, never request input), and returns `proxy_verified: true`
  with the observed exit IP, or a failure with the stage (`proxy_connect`,
  `proxy_auth`, `tunnel`, `tls`, `response`). It states that this does not verify
  the exit's country.
* The Connect page shows "API reachable / proxy traffic not tested" until a real
  session test succeeds.

## 5. How a region is verified

Three different things are kept apart and displayed with their source and time:

| Evidence | Meaning |
| --- | --- |
| **Provider-declared country** | a claim from the provider/listing (when the control API exposes it) |
| **Observed egress IP** | measured from the *same browser* that loads your site, before and after the capture |
| **GeoIP estimate** | a country estimate for that IP; **not proof of physical location** |

A region is `verified` only if the GeoIP estimate for the observed IP equals the
requested country and nothing contradicts it.

| Assurance | Cause | What happens |
| --- | --- | --- |
| `verified` | GeoIP matches (and any declared country agrees) | captured and interpreted |
| `unverified` | country unknown, or declared and estimated countries conflict | page is captured for inspection, **not** sent to the model, not counted as the region's behaviour |
| `mismatch` | GeoIP says another country, or the exit changed to one during capture | target page is **never loaded** (or, if it changed mid-run, the result is withheld) |
| `direct_egress` | observed IP equals the worker's own direct IP | treated as a proxy bypass; not loaded |
| `unavailable` | no egress observed, or no session could be obtained | region fails; says nothing about your site |

A failed or unavailable region can never produce a clean report: the job is
`partial` or `failed`, and rerun comparison marks the region **incomparable**
rather than "fixed".

### 5.2 Gateway behaviour I checked and did not change

`provider_selection.rs::geo_matches` accepts providers with empty country
metadata, and `LockFreeNodeRegistry::get_best_for` falls through to `get_best()`
(any healthy node) when the requested country has no node. The Go
`selectProviderNode` has a similar global fallback. So **a session requested for
country X can silently exit elsewhere**, for every existing user.

I did not change that routing (it would alter behaviour for all users, and a Go
toolchain is not available on this machine). The auditor's guarantee comes from
verification instead: because it observes the real exit, a silent fallback shows
up as `mismatch` and is refused. If strict routing is wanted later it should be
an opt-in claim in the signed session intent, validated in both
`services/control-api/internal/sessionintent/token.go` and
`services/edge-gateway/src/auth/session_intent.rs`. No sticky-rebinding,
failover, pinned-node or directory-selection path was changed.

The real testnet gateway answers an unauthenticated `CONNECT` with
`407 Proxy-Authenticate: Basic realm="ProxyHub"` (checked once on 2026-11-01),
which is the challenge Chromium needs to supply session credentials. That
credentialed path has not been exercised with a live session.

## 6. Evidence modes

Always shown, on every page, in exports and in the model's own context:

| Mode | Meaning |
| --- | --- |
| **Live capture** | newly collected through a real ProxyHubb session you authorized |
| **Recorded replay** | an earlier live capture re-analysed; each capture keeps its original `capturedAt`, and the analysis has its own new timestamps |
| **Synthetic fixture** | a local demo site visited through a local proxy; routes, IPs and locations are fake. Development-only: the worker refuses `AUDITOR_FIXTURE_ENABLED` when `NODE_ENV=production` |

A live Meta call analysing synthetic evidence still tells the model, and the
report, that the evidence is synthetic. Replaying a *synthetic* capture stays
synthetic. With no model configured the report says **"AI analysis not run"**
and keeps the captures. The evaluation's ground truth lives in
`src/eval/groundTruth.ts` and never appears in a report as if it were model output.

## 7. Meta AI integration

Verified against `https://api.meta.ai/v1` on 2026-11-01 with a real key:
`POST /responses`, model `muse-spark-1.3` (configurable), images as `input_image`
data URLs, `text.format` strict JSON schema generated from the zod contracts.

* **Stage 1, plan:** the user's goal becomes ≤ 6 checks from a closed vocabulary
  (`find_text`, `find_control`, `read_currency`, `follow_link`, `scroll_capture`).
  Unsupported actions, URL-like parameters and surplus checks are dropped; failure
  falls back to a clearly labelled default plan. Reruns reuse the same plan so
  results are comparable.
* **Stage 2, analysis:** screenshots + sanitized evidence per **verified** region.
  Output is validated: unknown evidence ids are removed, a finding with no valid
  evidence is dropped, regions without cited evidence are removed, locations must
  point at real screenshots/checks, a claimed defect the recorded facts cannot
  support is downgraded to a *hypothesis*, hypotheses cannot be critical/high,
  and an expectation cannot be "met" while an observed defect cites it. Every
  removal or change is recorded and shown.
* Findings are classified **observed defect / regional difference (may be
  intentional) / hypothesis**, with uncertainty in words. No numeric confidence.
* Page text and screenshots are untrusted input: they are delimited, the prompt
  says to ignore instructions inside them, and the model's output is constrained
  by the schema and checked. Two evaluation cases contain prompt-injection text.
* **Failure states are real states**: missing key → "AI analysis not run";
  rate limit (bounded retries honouring `Retry-After`); refusal; malformed
  output; **truncated** (reasoning tokens count against the output budget, found
  live and handled); timeout; call-budget exhausted. Evidence always survives, and
  **Retry AI analysis** reruns only the analysis (≤ 3 attempts).
* **Data mode:** the default model is *standard* (Meta does not train on it). A
  `-contributor` model, which Meta trains on, is refused unless
  `AUDITOR_ALLOW_CONTRIBUTOR_MODE=1`.
* **Usage and cost:** token counts are the provider's own. Cost is computed from a
  configurable price list (default: the documented Muse Spark 1.3 standard prices,
  read 2026-11-01) and labelled **estimate**. Hard cap of model HTTP calls per
  audit (`AUDITOR_MAX_MODEL_CALLS_PER_JOB`).
* Request is sent with `store: false`. The key is read from `MODEL_API_KEY` on the
  worker only and is redacted from errors and logs.

## 8. Architecture

```
Browser ──(bearer)──► Next.js route handlers /api/audits/**
                        │  1. authenticate (JWT_SECRET or /v1/auth/me)   ◄── same trust model as middleware.ts
                        │  2. live: mint sticky session intents with the CALLER's token (plan limits,
                        │     entitlements, metering, escrow all apply; escrow-required ⇒ region unavailable)
                        ▼  3. HMAC-signed request (owner, method, path, body hash, ts, nonce)
              services/regional-auditor (worker, node:http, internal only)
                 queue ─► pipeline: plan ─► capture(region) ─► analysis ─► finalize
                                       │            │
                       FileJobStore / PgJobStore    Chromium per region ── proxy ──► gateway ──► provider ──► your site
                       private artifact store       (policy-checked on every request; egress probed in-browser)
```

* The browser never reaches the worker. Credentials exist only in worker memory;
  a restart marks interrupted jobs and asks the user to rerun.
* Ownership is enforced in the store (`getOwned`, scoped `list`) and on artifact
  and export routes; another user's id answers **404**. Screenshots are private
  files served only through an ownership check, and only if the report references
  them. Changing state requires the bearer header (a cookie alone is not enough)
  and a same-origin `Origin`.
* Concurrency: `AUDITOR_MAX_CONCURRENT_JOBS` (1), `AUDITOR_MAX_CONCURRENT_BROWSERS`
  (2), per-owner active jobs (2), per-owner creates per hour (20), queue length (20).

## 9. Security and network boundaries

* **Targets:** live audits only reach HTTPS origins listed in
  `AUDITOR_ALLOWED_TARGET_ORIGINS`. Loopback, private, link-local, metadata,
  CGNAT, IPv4-mapped/NAT64/6to4 IPv6 and encoded IP forms are rejected
  (tests cover each class). Hostnames are also checked against local DNS answers.
* **Every browser request the page initiates** (navigation, sub-resources, iframes)
  is checked, before it is sent, against the same policy: approved origins only, no
  downgrade to HTTP, GET/HEAD/OPTIONS only, request and byte budgets. Policy blocks
  are listed separately and are never reported as site defects. WebSockets, popups,
  downloads and service workers are blocked.
* **Redirects are the exception, and this was learned the hard way.** Playwright does
  not call its route handler for redirect hops (verified with a three-server probe: a
  page redirected A → B → C loaded C although the handler aborted C), and adding a
  second CDP `Fetch` interceptor breaks Playwright's proxy authentication (verified
  against the authenticating fixture proxy). So the worker **cannot prevent** a redirect
  to an unapproved destination. It **detects** it from the request events, stops the
  navigation immediately (`Page.stopLoading`), captures **nothing** from that origin
  (no text, screenshot or checks; the page's status is not reported as the site's),
  records it in `policyViolations`, and says so in the report. Prevention has to
  happen at the gateway: with `AUDITOR_RESTRICT_INTENT_DOMAINS=1` the web server binds
  each session to the approved hosts through the signed intent's `allowed_domains`.
  That control is **off by default and unverified** against a live gateway (how it
  matches hosts is not something I could observe). Redirect-hop requests from
  out-of-process iframes and workers are likewise detect-only at best.
* **No direct path:** the browser is launched with the region's proxy and no
  bypass list; WebRTC is restricted to proxied UDP; the exit IP is compared with
  the worker's own direct IP to detect a bypass.
* **Secrets:** proxy credentials and the API key are never persisted, logged,
  exported or sent to the model. Visible text is redacted (tokens, JWTs, emails,
  card-like numbers, long opaque strings) before it is stored or sent. Exports omit
  the owner id and mask session references. HTML export has no scripts and a strict
  CSP, and model text is escaped (tested with `<script>` and `<img onerror>`).
* **Residual limitations (honest list):**
  * Proxy resolves DNS itself. Local DNS checks cannot rule out DNS rebinding or
    split-horizon answers; the gateway and provider destination controls remain
    the authoritative boundary and were not modified.
  * Browser-level interception is not a complete network boundary: redirects are
    detect-only (above), and non-HTTP protocols or future browser features are not
    covered. Treat the gateway/provider controls as the real boundary.
  * GeoIP is an estimate and the default provider is a free public service with
    rate limits; when it is unavailable regions become `unverified`, not verified.
  * Screenshots live on the worker's disk; there is no object storage or retention
    policy yet.
  * Page timings include proxy hops and rendering and are labelled as not pure
    network latency.
  * One browser profile (desktop Chromium 1280×800, `en-US`, UTC) is used for every
    region so locale/device never explains a regional difference. Locale-specific
    sites are therefore audited with an English-US browser from each region.

## 10. Setup and running

Prerequisites: Node ≥ 24 (the worker runs TypeScript directly), Chromium available
to Playwright 1.57 (`npx playwright install chromium`, or set `AUDITOR_CHROME_PATH`).

### 10.1 Local demo (fixture mode, needs no ProxyHubb session)

```bash
# terminal 1: the worker (development secret; generate your own for anything else)
cd services/regional-auditor
npm install
export AUDITOR_SERVICE_SECRET=dev-only-secret-change-me-0123456789abcdef
export AUDITOR_FIXTURE_ENABLED=1        # demo site + local fixture proxy, in-process
export MODEL_API_KEY=...                # optional: without it you get "AI analysis not run"
node src/server.ts                      # http://127.0.0.1:4021

# terminal 2: the web app, with the same secret
cd apps/web
export AUDITOR_SERVICE_SECRET=dev-only-secret-change-me-0123456789abcdef
export AUDITOR_URL=http://127.0.0.1:4021
export JWT_SECRET=<your dev JWT secret>          # the same one your control API signs with
npm run dev                                       # http://localhost:4011/app/connections?tab=audits
```

PowerShell: `$env:NAME = "value"` instead of `export NAME=value`.

Sign in as usual and open **Connections → Audits**. With the control API stopped, the
page still works in fixture mode (the region list is then the fixture's own).

### 10.2 Live mode, step by step

1. **Check readiness** (read-only; sends nothing to ProxyHubb besides one unauthenticated CONNECT, spends no model tokens):

   ```bash
   cd services/regional-auditor
   AUDITOR_SERVICE_SECRET=<any 32+ chars for this check> AUDITOR_PROXY_ENDPOINT=proxy.proxyhubb.com:8090 \
   AUDITOR_ALLOWED_TARGET_ORIGINS=https://your-authorized-site.example \
     npm run preflight -- --api-url https://api.proxyhubb.com --regions GH,US
   ```

   Every failure names the variable to fix. It also checks the gateway's 407 challenge, the target's
   reachability and DNS, the echo service, GeoIP, `MODEL_API_KEY` (via the free `GET /models/{id}`),
   Chromium, storage and the region inventory.
2. **Start everything** with one command (it runs the preflight first and generates a fresh shared secret
   that is never printed or stored):

   ```bash
   npm run stack -- live --api-url https://api.proxyhubb.com --target https://your-authorized-site.example
   ```

   `npm run stack -- fixture` does the same for the synthetic demo; `--no-web` starts only the worker.
3. **Sign in yourself** at <http://localhost:4011/login> with your wallet. The control API sets host-only
   cookies with `Secure` on the testnet; browsers accept `Secure` cookies from `http://localhost`, so this
   should work in Chrome or Edge, but it has **not** been verified without a real sign-in.
4. Open **Connections → Audits**, choose **Live**, pick GH and US, run. The Create form lists regions from
   `GET /v1/listings/facets` (provider-declared) and says so.

### 10.2.0 Where audits live in the product

Audits are part of the existing buyer flow, not a separate area. There is no extra workspace destination:

* **On an active order's page** (`/marketplace/orders/[id]`, `/app/activity/orders/[id]`): a card, "Check a website from
  Ghana (GH)", next to the connection details. It opens a dialog with the order and its region already chosen, so only
  the address and the expectations are asked.
* **On each access card in Connections**: an "Audit a site" button that opens the same dialog.
* **In Connections → Audits**: the full form (several regions, several orders) and the history of past reports.
* **Report pages** (`/app/audits/[id]`) keep their own address because a report needs a stable link. `/app/audits`
  redirects to the Audits tab.

The entry points appear only where they can work: they stay hidden when the Regional Auditor is not deployed
(`AUDITOR_SERVICE_SECRET` unset), and the order card only appears for an order that is active, belongs to the user and
is listed in a country. Browsing surfaces (listings, the map) deliberately have no audit button: an audit spends the
bandwidth of an order the user already holds, so the natural place to start one is where that access is used.

### 10.2a Running over orders you already paid for

On a deployment that requires an escrow-funded session, **Open new sessions** (step 4) returns
`session_escrow_required`: the new session cannot carry traffic until your wallet funds it, and the audit never
funds anything. The supported alternative is to buy bandwidth through the normal marketplace flow (your wallet
signs; the audit is not involved) and then run the audit with **Use my funded orders**, which is the Create
form's default for live audits since 2026-11-02. (The first signed-in live run that day left the old default,
**Open new sessions**, selected and failed with `session_escrow_required`.)

1. Buy a small order on a listing in each region you want to compare, and wait until it is **active**.
2. In **Live**, keep **Use my funded orders**. The form lists only the regions where you hold an active order whose
   listing declares a country, and a selector per chosen region when you hold several. With no such order it says
   so and links to the marketplace instead of offering regions.
3. Run. The web server reads each chosen order with **your own token** (`GET /v1/orders/{id}` then
   `/credentials`), so ownership, status and expiry are enforced by the control API, and passes the order's
   session credentials to the worker in memory. The audit stores only the order *ids* (so **Rerun and compare**
   uses the same orders), never the credentials.

What is checked before any traffic: the order is yours, **active** (credentials of other states are never
requested, because the control API may try to re-activate a session when asked), not expired, uses HTTP Basic
(`hmac`) authentication, targets the same gateway as `AUDITOR_PROXY_ENDPOINT`, and its listing does not declare
a different country than the region it was chosen for. A failure of any check makes that region `unavailable`
with the reason; no other order, session or direct connection is substituted.

What is **not** taken on trust: the listing's country is the seller's claim. The worker still observes the real
exit IP in the same browser, before and after the capture, and refuses to interpret an exit that does not
verify (`mismatch`, `unverified`, `direct_egress`). An order is only a source of credentials.

Limits of this source: it spends some of the chosen orders' bandwidth on every run and rerun; the control API
does not tell the auditor whether an order's session is sticky, so a rotating session can change exit between
the before and after probes (the report then notes that the egress IP changed and the worst probe decides the
assurance); and `AUDITOR_RESTRICT_INTENT_DOMAINS=1` cannot be applied to an existing order, so with it on the
BFF refuses to start an order-based audit rather than silently dropping the gateway-side restriction (redirect
*detection* in the worker still applies).

To audit a site with real, seeded regional defects, deploy `demo-site/` yourself (see its README), then use its
URL as `--target`. You can also point the audit at any site you are authorized to test.

### 10.3 Environment

Complete, commented list: [`services/regional-auditor/.env.example`](../../services/regional-auditor/.env.example)
and the audit section of [`apps/web/.env.example`](../../apps/web/.env.example).
Secrets (`AUDITOR_SERVICE_SECRET`, `MODEL_API_KEY`, `AUDITOR_DATABASE_URL`) are
only ever reported by variable name, and `/capabilities` returns presence flags only.

### 10.4 Browser tests

```bash
cd apps/web
# deterministic UI states (API mocked at the network layer)
npx playwright test e2e/audits.spec.ts --project=chromium --workers=1 --reporter=list

# full stack: start the worker as in 10.1 first, then (same secret on both sides)
AUDITOR_E2E_FULLSTACK=1 AUDITOR_URL=http://127.0.0.1:4021 \
AUDITOR_SERVICE_SECRET=dev-only-secret-change-me-0123456789abcdef \
AUDITOR_E2E_SCREENSHOT_DIR=../../docs/hackathon/screenshots \
  npx playwright test e2e/audits-fullstack.spec.ts --project=chromium --workers=1 --reporter=list
```

The full-stack spec is skipped (not passed) when `AUDITOR_E2E_FULLSTACK` is unset.
Playwright starts its own `npm run dev:e2e` server; do not run `next build` at the same
time (they share `.next`).

### 10.5 PostgreSQL

Apply `migrations/000176_regional_audits.up.sql` and set `AUDITOR_DATABASE_URL`.
Without it the filesystem store under `AUDITOR_DATA_DIR` is used. Run the store
contract against a disposable database with
`AUDITOR_TEST_DATABASE_URL=... npm test`. (It was verified on 2026-11-01 against PostgreSQL 14.24 started
from the `embedded-postgres` npm package in a scratch directory, because Docker cannot run on that machine.)

## 11. Checks actually run

Everything below was executed on this Windows machine on 2026-11-01.

| Check | Command | Result |
| --- | --- | --- |
| Worker typecheck | `cd services/regional-auditor && npx tsc --noEmit` | clean |
| Worker tests | `npm test` | **196 passed, 0 failed** (including the marketplace-order credentials path and the no-model-call-without-a-session case). Unit: target/IP policy, egress assurance, redaction, request signing, model-output validation, Meta client failure modes, stores, rerun comparison, evaluation scoring. Integration (real Chromium, real authenticating fixture proxy, real demo site, rule-based stand-in for the model): success, wrong-country, unknown-country, mid-run route change, refused proxy, model failure + analysis-only retry, no-model, cancel (running and queued), abandoned-job recovery, ownership, replay, rerun, network policy, redirect detection, call budget, retention; **live transport against a simulated authenticating gateway**; live-readiness preflight; deployable demo site incl. byte parity with the fixture; HTTP API incl. signed requests, artifacts, exports, HTML escaping |
| PostgreSQL store contract | default `npm test` (`AUDITOR_TEST_DATABASE_URL` unset) | **skipped** there (reported as skipped, not passed) |
| PostgreSQL 14.24, real server | embedded PostgreSQL, migration + `AUDITOR_TEST_DATABASE_URL=... node --test test/store.test.ts` | migration up (twice), 4 CHECK constraints enforced, **store contract 7/7**, down then up all pass |
| Preflight against the real testnet | `npm run preflight -- --api-url https://api.proxyhubb.com --regions GH,US` | all checks ok: gateway answers 407 Basic, target reachable, GeoIP, Meta key sees `muse-spark-1.3`, Chromium launches, listings declare GH x2 and US x1 |
| Stack launcher, live mode | `npm run stack -- live ...` (no sign-in) | worker healthy, web up, `/v1/listings/facets` through the web app's rewrite returns the real listings, audit API answers 401 without a token and 403 cross-origin, anonymous proxy test says "API reachable, proxy not tested" |
| Edge worker bundle | esbuild `--platform=neutral` on `demo-site/worker.ts` | bundles to 9.7 KB with no Node APIs; the bundle serves the seeded defect |
| Web typecheck | `cd apps/web && npm run typecheck` | clean |
| Web lint (changed files) | `npx eslint …` | clean |
| Route registry | `npm run validate:routes` | passes (93 static routes, 104 policy entries, middleware guard coverage) |
| BFF/probe unit tests | `node --test scripts/proxy-probe.test.mjs scripts/audit-bff.test.mjs scripts/audit-orders.test.mjs` | 17 passed (402/407/refusal/timeout/TLS-verification paths of the proxy probe; web signer ⇄ worker verifier byte compatibility; JWT verification; order listing/credential resolution with every refusal path, and that the body sent for an order-based audit parses under the worker contract) |
| Production build | `npm run build` | succeeds; manifest contains all 9 `/api/audits/**` handlers and `/app/audits`, `/app/audits/[id]` |
| Audits UI, mocked API | `npx playwright test e2e/audits.spec.ts --project=chromium --project=webkit --project="Mobile Safari"` | **25 / 25 on each of Chromium, WebKit and mobile Safari (75)** (16 existing + 4 for running over my own orders + 5 for the placement inside Connections and order pages): create/validate/keyboard, running to settled polling, wrong-region and failed regions, "AI analysis not run", failed analysis + retry, comparison groups, export, foreign audit 404, dialog focus return, **axe WCAG 2 A/AA: 0 violations** on both pages, phone viewport with no horizontal scroll. The WebKit run found a real defect Chromium missed (a horizontally scrollable table that keyboards could not focus); fixed by making both table wrappers focusable regions. Firefox is not installed here, so it was not run |
| Re-verification after merging current `main` (2026-11-02, `1933bb44`) | `npm ci`; `npm run typecheck`; `npm run validate:routes`; eslint on every touched path; worker `npm test`; web unit tests; Playwright | Typecheck, route validation and lint clean; worker 196/196; web unit 17/17. Audits e2e: on WebKit, mobile Safari and mobile Chrome every audit test passed in a full parallel run; on Chromium two tests (create form) failed under parallel load and passed when run alone and serially across all four projects. Firefox is configured on `main` but not installed here, so it was not run. Not caused by this feature and not fixed here: `marketplace-order-credentials.spec.ts` fails on every WebKit-family project (checked 2/2 with and without the audit hook), and `workspace.spec.ts` fails intermittently with aborted navigations. A clean-`main` baseline run was not done. |
| **Full stack** | `e2e/audits-fullstack.spec.ts` (needs the worker; see §10) | **1 / 1**: real worker, real Chromium captures through the fixture proxy, **real Meta analysis**, refresh-safe results, ownership (401 without a token), apply fix → rerun → "Resolved", sanitized JSON export |
| Regression: workspace | `e2e/workspace.spec.ts` | unchanged from the original (four destinations) and 5 / 5 on Chromium with the Audits tab in place; also 5 / 5 on WebKit when Audits was still a fifth destination (earlier layout, not re-run). On mobile Safari 3 pass and 2 fail: they assert the desktop-only "Primary" sidebar (hidden at phone width) and a workspace-switcher option, neither related to Audits; the repo's own scripts run this spec on Chromium only. Not verified against a clean checkout |
| Regression: route policy | `e2e/route-policy.spec.ts` | 4 passed, **2 failed, pre-existing and unrelated**: they expect a redirect to `/dashboard?error=provider_required` / `admin_required`, but `middleware.ts` (unmodified) redirects to `/403`, nothing in `src` emits those parameters, and spec and middleware both date from 2026-08-01. Left untouched |
| Live Meta API | scratch probes + the evaluation | request/response shape, strict schema, vision input, usage fields, truncation behaviour all observed on `api.meta.ai/v1` |
| Real-TLS probe | local CONNECT forwarder → `api.ipify.org` | `/api/proxy/test` POST logic returned a verified exit IP in 688 ms |
| Secret hygiene | scan of 921 created/changed files + stored data for the real `MODEL_API_KEY` | 0 occurrences |

After the browser tests the dev server and the worker were stopped.

Not run, and why: Go and Rust checks (no Go toolchain; no Go or Rust code changed), Docker
(the Docker Desktop daemon cannot start here because the WSL feature is not enabled; enabling it is a system
change I did not make, so no Dockerfile is provided because it could not be tested), Firefox (not installed),
the Cloudflare Worker on Cloudflare's own runtime (only bundled and run under Node), and the full repository test suite (only checks relevant to
changed code were run; no unrelated failures were investigated or "fixed").

## 12. Evaluation

Run with `cd services/regional-auditor && npm run eval -- --repeat N`. It starts the fixture
harness, runs 15 labelled cases through the **real** pipeline with the **real model**
(`muse-spark-1.3`, standard mode), and scores them against hand-written ground truth
(`src/eval/groundTruth.ts`). Raw per-run results are in
[`eval-results/`](eval-results/) and are kept apart from the ground truth.

The suite: 9 cases with 11 seeded defects (signup obscured in one or both regions,
signup missing, wrong currency shown to the US or to Ghana, a required script failing,
an HTTP 500, and the two-defect headline demo) plus 6 controls (the fixed site, two
healthy sites with a *legitimate* regional promo or currency difference, a bot-challenge
page that is not evidence of a defect, and two pages carrying prompt-injection text,
one of which also has a real defect).

Four passes (60 runs; the fourth on the final code), 2026-11-01:

| Measure | Result |
| --- | --- |
| Seeded defects reported as *observed defects* | **44 / 44** (hypothesis-only 0, missed 0) |
| Evidence at capture level (objective signal present in the captured evidence, independent of the model) | 44 / 44 |
| Control runs with a false alarm (an observed defect where none was seeded) | **0 / 24** |
| Hypotheses raised on controls | 6 (all on the bot-challenge page, which is the cautious reading we wanted) |
| Extra observed defects on defect cases | 1 (on the HTTP-500 page, a secondary symptom: "no GHS price because this is an error page"); precision 97.8%, recall 100% |
| Findings kept / removed as unsupported / adjusted by validation | 50 / 0 / 4 (e.g. a hypothesis's severity capped); 0 invented evidence references appeared |
| Job latency (queued → report, 2 regions, includes browser capture and 2 model calls) | p50 10.9 s, p95 15.3 s (model calls p50 9.2 s) |
| Provider-reported usage | 399,189 input / 150,189 output tokens |
| Estimated cost (documented standard prices; an **estimate**) | $1.02 for 60 runs, about $0.017 per audit |

**What this does not show.** The same people wrote the demo site, the defects and the
labels; the site is deterministic and tiny; a model can recognise "cookie banner covering
the button" patterns. A perfect score on 15 seeded cases is a smoke test of this pipeline
and its guard rails, not a claim of general accuracy on real sites, real regional
differences, noisy pages, other languages or other models. It is also not independent of
development: an early run on the *fixed* demo site produced a false alarm (the planner
had guessed that "Sign up" was a link, and the analyzer over-trusted that check). That
exposed a design flaw rather than a one-off, and led to optional-role `find_control`
checks, a prompt rule that planned checks are guesses, and a grounding rule that
downgrades `element_missing` when the name appears in the page text. The numbers above are
after that change. Model output varies run to run, which is why several passes are
reported and the raw files are included.

## 13. Outstanding live prerequisites

### 13.0 First real live audit (2026-11-02)

The user signed in to the local web app (against `https://api.proxyhubb.com`, the testnet API, then running
main as of #124, deployed 2026-11-01) and ran audits over their own Ghana marketplace order:

| Audit | Result |
| --- | --- |
| `aud_428b30228d2a` (13:50 UTC) | GH `unavailable` · `order_not_ready`: the control API answered that the order's proxy credentials were not ready yet. Nothing was captured and no model call was made. |
| `aud_a397dd463c47` (13:56 UTC) | **completed.** Exit IP observed through the audit browser before and after capture, unchanged; GeoIP (`ipwho.is`) and the seller-declared listing country both say GH, so the route is `verified`. Main document HTTP 200, two screenshots, 2 model calls on `muse-spark-1.3-contributor` (7,468 in / 2,644 out tokens, estimated $0.0013). Expectations: page loads **met**; signup **unclear** (the site says "Get started"/"Sign in", and clicking was not tested); prices in the expected currency **not met**. One finding: the homepage shows no pricing and no currency for GH. |

What this settles from the list below: the credentialed tunnel through the **real** gateway works with a
marketplace order's per-session username and HMAC password; signing in through a local web app against the
remote API works; the target is reachable from that exit, and that order's exit is in the country its listing
declares (GeoIP estimate). Still open: a second region, and the `session-intent` path (blocked by escrow).

The same run exposed a defect, now fixed: after capturing, the worker re-checks the exit under an echo-only
request policy but had left the target page open. proxyhubb.com kept prefetching (`/provider`, redirected to
`/login`), so 15 of its own same-origin requests were blocked and two were reported as policy violations with
the false reason "origin https://proxyhubb.com is not approved", and that noise was part of the model's input.
The page is now closed before the re-check and page events stop counting once capture ends
(`test/livepath.test.ts`, "does not blame the site for its own background requests"). The stored report for
`aud_a397dd463c47` still carries that noise; a rerun produces a clean one.

Live acceptance (real captures through two real regional exits) still needs these. They are the user's to
provide or authorize; none were available to me:

1. **You, signed in.** A buyer account on the deployment the web app points at. I cannot sign in or sign a
   wallet challenge for you, and I do not hold credentials. Run `npm run stack -- live ...` and sign in in the
   browser; I can then read the job file or the exported report.
2. **A target you may audit.** Any HTTPS site you control, or the controlled demo in `demo-site/`, which you
   would deploy yourself (Cloudflare account, your decision to publish).
3. **Usable sessions.** On 2026-11-01 the public testnet API listed active listings in **GH (x2)** and
   **US (x1)** and the gateway answered a CONNECT with the Basic 407 challenge. On 2026-11-02 the first signed-in
   live run showed that the testnet **requires an escrow-funded session** (`session_escrow_required` from
   `POST /v1/sessions/intent`), so a new session cannot carry traffic until your wallet funds it. The audit
   never funds anything. The way forward is to buy a small order per region through the normal marketplace flow
   and run the audit with **Use my funded orders** (§10.2a). Whether those nodes are online and routable is
   still only learned from the first real capture.
4. A **GeoIP source that answers** (default `ipwho.is`); otherwise exits are `unverified`.
5. A **`MODEL_API_KEY`** (present here and used for §7 and §12; the preflight confirms the key sees the model).

Retired since the first version of this document: whether Chromium, driven by Playwright, answers a gateway's
`407` Basic challenge, tunnels HTTPS over CONNECT with TLS verification, probes its exit over HTTPS and
respects a gateway-side allow-list. That is now exercised by `test/livepath.test.ts` against a local simulation
that speaks the same protocol (a simulation, not a ProxyHubb gateway).

Still unvalidated in the live path, to confirm on the first real run:

* the credentialed tunnel through the **real** gateway, with `session-intent` credentials and with a marketplace
  order's per-session username and HMAC password (both only simulated so far);
* whether an order's exit is in the country its listing declares (the audit will say, per run);
* the units of `bandwidth_limit` in `POST /v1/sessions/intent` (assumed bytes);
* how the gateway matches `allowed_domains` (hence `AUDITOR_RESTRICT_INTENT_DOMAINS` is off by default);
* that signing in through a local web app against the remote API works (host-only `Secure` cookies on `localhost`);
* that the target is reachable from a regional exit, and that the exit is the country its listing declares.

### 13.1 Reading the first live run

`cd services/regional-auditor && npm run inspect` prints the latest stored audit (route evidence per region, why a region
was or was not interpreted, findings, usage). It reads only the local job store, which never holds credentials.

| What a region shows | Most likely cause | Next step |
| --- | --- | --- |
| `unavailable` · `session_escrow_required` | the deployment requires an escrow-funded session; the audit will not fund one | buy and activate a marketplace order, then run again with **Use my funded orders** (§10.2a) |
| `unavailable` · `no_order_selected` / `invalid_order` / `order_not_found` | no order chosen for the region, or it is not in your account | pick one of your active orders |
| `unavailable` · `order_not_active` / `order_not_ready` / `order_expired` | the order is not active, its session is not ready yet, or it expired | wait and retry, or buy a new order |
| `unavailable` · `order_region_mismatch` | the order's listing declares another country than the region chosen | choose an order for that region |
| `unavailable` · `order_gateway_mismatch` / `order_credentials_unsupported` | the order's gateway or authentication scheme is not the one the auditor is configured for | check `AUDITOR_PROXY_ENDPOINT` against the order's endpoint |
| `unavailable` · `session_limit` / `plan_bandwidth_quota` | your plan's concurrent-session cap or bandwidth quota | end a session or wait, then rerun |
| `unavailable` · `session_refused` / `control_api_unreachable` | the control API refused or could not be reached | read the message; check `API_URL` and that you are signed in |
| `unavailable` · `proxy_not_configured` | `AUDITOR_PROXY_ENDPOINT` unset on the worker | `npm run preflight` |
| `failed` · `egress_probe_failed` | the gateway rejected the session, the exit has no route, or the echo host is not reachable through it (for example excluded by `allowed_domains`) | `npm run inspect`; try with `AUDITOR_RESTRICT_INTENT_DOMAINS` unset; check the echo URL |
| `mismatch` | the exit's IP geolocates to another country than requested: a real finding about that supply, not a bug | rerun (a different node may be chosen) or pick another listing |
| `unverified` | no GeoIP answer for the exit, or declared and estimated countries conflict | retry later (GeoIP rate limits) or set another provider; the page is kept but not interpreted |
| `failed` · `direct_egress` | the observed IP equals the worker's own IP: the request did not leave through the proxy | stop and investigate before trusting any run |
| `captured`, and a "blocked or challenged" hypothesis | the site served a bot challenge to that exit | not a site defect by itself; allow the exit or test another |
| `captured`, but results differ from what the site's own geo logic should do | the site classifies the visitor's IP differently from the auditor's GeoIP source | expected sometimes; the report shows what the site actually served |

## 14. Demo script

The official event page (<https://dev.meta.ai/events/global-hackathon>, read
2026-11-01) publishes: submission due **Nov 4, 9:00 PM ET** (that is 02:00 on Nov 5
in Accra; confirm against the portal), judging Nov 4-8, two tracks, and judging on
"creativity, technical ambition, and whether it works" (indie) or "technical
execution and whether it holds up in production" (startup). It does **not**
publish a video length, required submission fields or pre-existing-code rules;
Official Rules go to accepted participants, and the Cerebral Valley details page did
not render for me. Participation requires organizer acceptance, which I did not
assume. **Check the portal for the real video limit and fields before recording;
the timings below are a suggestion, not a requirement.**

Timeline (about 3 minutes; trim to the portal's limit):

1. **Problem (15 s).** "I can't see my site from my customers' networks."
2. **Request (20 s).** *Connections → Audits* → *Synthetic fixture* mode → Ghana + United
   States → the default expectation → *Run audit*. Say out loud that this mode is
   synthetic and why it exists.
3. **Routing observations (30 s).** On the running page show the stages; on each
   region card show the **observed exit IP, GeoIP estimate with source and time,
   declared country, and assurance**. Mention that a mismatch would be refused.
4. **Captures (20 s).** Side-by-side screenshots: Ghana's signup button hidden by a
   cookie banner; the US page priced in Ghanaian cedis.
5. **A supported finding (30 s).** Open the Ghana finding: observed vs expected,
   evidence chip → jumps to the region, reproduction steps, uncertainty in words,
   and the "Validation" line showing unsupported claims are removed.
6. **Fix and rerun (30 s).** *Demo site* panel → **Apply the fix (demo-v2)** →
   **Rerun and compare**.
7. **Comparison (20 s).** "Resolved (2)", with the caveat that unverified regions
   are never counted as fixed.
8. **Export + honesty (15 s).** Download the HTML report; point at the provenance
   banner and limitations; state that live validation through two real exits is
   pending (§13) and what the measured evaluation does and does not show.

Labelled controlled defects (by design, documented in
`services/regional-auditor/src/fixtures/scenarios.ts`): `demo-v1` hides the signup
button behind a cookie banner **in GH only** and shows the Ghana price **to US
visitors**; `demo-v2` is the fixed site.

## 15. Layout of the worker

```
src/contracts.ts        zod schemas for jobs, evidence, findings, internal API
src/config.ts           env parsing, limits, presence-only reporting
src/targetPolicy.ts     URL/redirect/IP policy applied to every request
src/geo.ts              GeoIP providers, egress assurance rules
src/redact.ts           secret/PII redaction
src/browser/            capture.ts (isolated Chromium per region), checks.ts (closed vocabulary)
src/ai/                 meta.ts (client), stages.ts (prompts), validate.ts (grounding rules)
src/pipeline.ts runner.ts compare.ts export.ts store/ app.ts server.ts auth.ts
src/preflight.ts preflightCli.ts   live-readiness checks (npm run preflight)
scripts/stack.mjs       one-command launcher (npm run stack)
demo-site/              deployable edge version of the demo site (NOT deployed by this repo)
src/fixtures/           demoSite.ts (shared renderer), demoTarget.ts, local fixture proxy, scenarios (DEV ONLY)
src/eval/               ground truth, scoring, runner, CLI
test/                   unit + integration tests
```
