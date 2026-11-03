# ProxyHubb MCP for everyday agents: audit and plan

**Date:** 2026-11-03 · **Status:** approved by the owner 2026-11-03 (all four decisions as recommended, section 6).
Phase 0 runs before the submission; everything else after it.
**Scope:** `services/proxyhubb-mcp`, the credentials and payments it depends on, and how a person connects it
to the AI agents they already use (Claude Desktop, Claude Code, Cursor, VS Code, ChatGPT, Claude.ai, agent
frameworks).

## 1. Verdict

**Not easy yet.** The server's core is sound: safe defaults, exit verification, refusal codes, redaction,
30 passing tests, and the order path proven live on 2026-11-03. But getting it into someone's daily agent
takes a repo clone, Node 24, and a login token copied out of browser DevTools that expires within a day. And
once it is connected, a chat agent mostly can't *use* what it gets back: a proxy URL. The fixes, in order of
value:

1. **A credential a normal user can get:** an "AI agents" page that issues a revocable agent key.
2. **Tools that do the work**, such as fetching a page as seen from a country, instead of handing the model
   a credential.
3. **One-line install** (npm and a Claude Desktop extension), then a **hosted endpoint** for ChatGPT and
   Claude.ai.

## 2. The journey today (what actually happened on 2026-11-03)

| # | Step a user must take | Friction found |
| --- | --- | --- |
| 1 | Clone the repo, `npm install` in `services/proxyhubb-mcp` | Not published to npm (`"private": true`), no `npx`, no Claude Desktop extension |
| 2 | Have **Node 24** | The server runs `.ts` files directly with Node's type stripping; Node 20/22 users fail. On Windows, PowerShell blocks `npm.ps1` (`npm.cmd` works) |
| 3 | Edit the MCP client's JSON with an absolute path to `src/server.ts` | Different file and format per client; nothing in the product shows it |
| 4 | Get `PROXYHUBB_ACCESS_TOKEN` | Only works by copying the `authorization` header from DevTools; expires within 24 h (default `ACCESS_TOKEN_TTL_MINUTES`). The first attempt used a provider node token (403, now explained since #136). A screenshot leaked the token into a chat |
| 5 | Buy an order in the web app with a wallet | The agent cannot buy or fund anything: intents need the buyer's wallet signature (`fundSessionIntentSolana`), so on testnet `create_agent_session` always answers `funding_required` |
| 6 | Run the agent | Works (order → credentials → real traffic). `verify_exit` said `direct_egress` because the node shares the user's connection (documented since #137) |
| 7 | Use the result in chat | The agent receives a `proxy_url`. A chat agent (Claude Desktop, ChatGPT) has no HTTP client to use it with, and the credential now sits in the model transcript |

## 3. Audit findings

Severity: **H** blocks everyday use · **M** hurts it · **L** polish.

| ID | Finding | Evidence | Sev |
| --- | --- | --- | --- |
| A01 | **No credential for everyday use.** Settings → API keys creates keys with `["read","proxy"]` only (`apps/web/src/lib/services/security.ts`); `/v1/api-keys` accepts only read/write/proxy/admin. The order routes need `orders:create` (`orders.go`, `requireBulkScope`), which only `/v1/bulk/api-keys` can grant, with no UI. So the only working credential is a DevTools-copied JWT that expires daily | `apikeys.go` `validAPIKeyPermissions`; `bulk.go` `parseAllowedBulkScopes` | H |
| A02 | **`orders:create` is too broad for an agent.** The same scope also creates, pays for and cancels orders. An agent that only spends prepaid orders needs a read-and-use scope | `RegisterPartnerPurchaseRoutes` | H |
| A03 | **Chat agents can't use a proxy URL.** No tool performs a request through the proxy except `verify_exit`. The everyday asks ("show me this page from Ghana", "compare GH and US prices") are impossible in chat; only code-writing agents benefit | `src/tools.ts` | H |
| A04 | **Credentials go to the model.** `create_agent_session` and `use_my_order` return the proxy password inside `proxy_url`, which lands in the transcript (and the model provider's logs) | tool output contract | M |
| A05 | **Install needs a repo clone and Node 24.** No package, no compiled JS, no one-click install | `package.json` (`private`, `bin` → `.ts`, `engines >=24`) | H |
| A06 | **Local stdio only.** ChatGPT and Claude.ai custom connectors (and therefore mobile) need a remote Streamable HTTP server; ChatGPT expects OAuth for non-public connectors | `server.ts` uses `StdioServerTransport`; SDK 1.32.2 already ships `streamableHttp` and auth helpers | M |
| A07 | **Agents can't pay.** Prepaid orders are the only path on testnet; buying needs the human's wallet. Acceptable as an "allowance" model, but the top-up step (buy an order for my agent) isn't designed for it | `session_intent_escrow.go` | M |
| A08 | **Discovery overstates supply.** `list_regions` counts listings, not online nodes; offline nodes still look purchasable; listing ISP labels go stale (HQ 30000 says SpaceX/Starlink, the real exit was MTN Ghana) | facets; live run 2026-11-03 | M |
| A09 | **No product surface.** No docs page in `apps/docs`, nothing on the website, README only | `apps/docs/content` | M |
| A10 | **No receipts for the owner.** No per-agent activity or spend view; `get_session_usage` returns raw records | `src/tools.ts` | L |
| A11 | **Order traffic has no per-task policy.** `use_my_order` spends the whole prepaid order; no domain allowlist or per-task cap on that path | `useMyOrder` | L |
| A12 | **`verify_exit` doesn't hint at the own-connection case** when it returns `direct_egress` | `verifyExit` | L |
| A13 | **Supply is one country**, usually one node online | facets | context |

**Worth keeping as is:** the safety model (caps, never funds, never bypasses), exit verification including the
satellite rule, order refusal codes, redaction, the clear provider-token error, the 30 tests.

## 4. What "easy" means (success criteria)

- **Local clients** (Claude Desktop, Claude Code, Cursor, VS Code): **first verified fetch in under 5 minutes**
  from the website, with no repo clone, no DevTools, and one copy-paste per client.
- **Hosted clients** (ChatGPT, Claude.ai web and mobile): add a URL, sign in, approve. No key copying.
- **Everyday tasks work in chat without code:** fetch a page from a country, compare two countries, audit my
  site.
- **Credentials stay on the server by default**; a proxy URL is returned only when explicitly requested.
- **A key survives daily use** (default 90 days, revocable in one click), and spending is bounded by orders the
  owner bought.

## 5. Phases

Each step lists size, acceptance, verification, files and blockers. Steps whose blockers are done may run in
parallel. Highest-risk first within each phase.

### Phase 0: hackathon-safe (MCP only, no server change, no deploy)
Verified when: in Claude Desktop, "fetch https://<demo-site> as seen from Ghana" returns the page through the
order exit, with the assurance shown, without any credential in the chat.

#### Step 0.1: `fetch_url` tool (Size: M)
- Acceptance: fetches an HTTPS URL through an active order (or a given session), verifying the exit first; returns status, final URL, title, a size-capped text excerpt and the assurance; never returns credentials. Refuses non-HTTPS, private/loopback addresses and oversize bodies.
- Verification command: `npm test` and `npm run typecheck` in `services/proxyhubb-mcp`; a live run with the owner's order.
- Files likely touched: `src/fetch.ts` (new), `src/tools.ts`, `src/server.ts`, `test/tools.test.ts`.
- Test seams: tool handlers with mocked probe and fetch (existing pattern).
- Blocked by: none.

#### Step 0.2: own-connection hint in `verify_exit` (Size: XS)
- Acceptance: a `direct_egress` result says the node may share the caller's connection and how to check.
- Verification command: `npm test`.
- Files likely touched: `src/tools.ts`, `test/tools.test.ts`.
- Blocked by: none.

#### Step 0.3: client quickstarts (Size: S)
- Acceptance: copy-paste setup for Claude Desktop, Claude Code (`claude mcp add`), Cursor and VS Code in the README, each verified to start the server.
- Verification command: start each config once; `npm run example`.
- Files likely touched: `services/proxyhubb-mcp/README.md`.
- Blocked by: none.

### Phase 1: a credential an everyday user can get (Go + web, then a deploy)
Verified when: a key made on the website runs `npm run example` end to end, and revoking it makes the next
call fail with 401.

#### Step 1.1: `orders:use` scope (Size: S)
- Acceptance: a bulk key with `orders:use` can call `GET /v1/orders`, `GET /v1/orders/:id` and `GET /v1/orders/:id/credentials`, and gets 403 on create, pay, confirm and cancel. Existing scopes behave as before.
- Verification command: `go test ./internal/api/...` (Go 1.26.10 toolchain, UTF8 Postgres).
- Files likely touched: `services/control-api/internal/api/bulk.go`, `orders.go`, tests.
- Blocked by: none.

#### Step 1.2: "AI agents" page in Settings (Size: M)
- Acceptance: create an agent key (name, expiry default 90 days, scope `orders:use`), shown once, with per-client copy-paste config (key pre-filled); list and revoke. Calls `/v1/bulk/api-keys`.
- Verification command: web typecheck, a focused Playwright spec, and a manual run of the shown config.
- Files likely touched: `apps/web/src/components/settings/` (new panel), `apps/web/src/lib/services/`, settings tab registry.
- Blocked by: 1.1.

#### Step 1.3: MCP docs switch to agent keys (Size: XS)
- Acceptance: README and `.env.example` lead with `PROXYHUBB_API_KEY`; the JWT stays as an advanced option.
- Blocked by: 1.2.

### Phase 2: one-line install
Verified when: on a clean Windows machine with Node 22, `npx -y <package>` starts the server, and the Claude
Desktop extension installs with a double-click.

#### Step 2.1: compile to JavaScript (Size: S)
- Acceptance: `npm run build` emits `dist/`; `bin` points to JS; `engines` becomes `>=20`; tests still run on `.ts`.
- Blocked by: none.

#### Step 2.2: publish the npm package (Size: S)
- Acceptance: `npx -y <package>` works; versioned releases; the README shows the one-liner.
- Blocked by: 2.1 and decision Q3.

#### Step 2.3: Claude Desktop extension `.mcpb` (Size: S)
- Acceptance: the bundle prompts for the agent key as a sensitive field and starts the server; attached to a GitHub release.
- Blocked by: 2.1, 1.2.

#### Step 2.4: "Use ProxyHubb with AI agents" docs page (Size: S)
- Acceptance: `apps/docs/content/agents/mcp.mdx` with per-client steps, the safety model and troubleshooting (provider token, `direct_egress`, satellite).
- Blocked by: 1.2, 2.2.

### Phase 3: tools that do the work
Verified when: in a chat client, "compare https://<demo-site> from GH and US" returns a side-by-side summary
with assurance per region.

- **3.1 `compare_regions`** (M): one URL from up to 2 regions; status, title, currency/price hints, differences. Blocked by: 0.1.
- **3.2 `run_regional_audit`** (M): calls the Regional Auditor worker; returns the report link and findings. Blocked by: the worker being reachable (Phase 4 hosting), decision Q4.
- **3.3 Credential reuse** (S): one cached order credential per process, refreshed on expiry; fewer `credentials` calls. Blocked by: 0.1.
- **3.4 Screenshots** (M, optional dependency): fog, because bundling a browser makes the package heavy. Researched at pickup.

### Phase 4: hosted MCP (ChatGPT, Claude.ai, mobile)
Verified when: ChatGPT (developer mode) and a Claude.ai custom connector both list the tools and run
`fetch_url`.

- **4.1 Streamable HTTP endpoint** (M): `https://mcp.proxyhubb.com/mcp` with `Authorization: Bearer <agent key>`, for Claude Code, Cursor, VS Code and the OpenAI Agents SDK. Blocked by: 1.1, decision Q4.
- **4.2 Abuse controls** (M): per-key rate limits, response size caps, SSRF guard (no private or metadata addresses), optional per-key domain allowlist, request logs without bodies. Blocked by: 4.1.
- **4.3 OAuth 2.1 sign-in for connectors** (L, to be split at pickup): ProxyHubb as authorization server (PKCE, client registration, consent screen issuing an `orders:use` token). Required for ChatGPT and Claude.ai. Blocked by: 4.1.

### Phase 5: budgets and payments (fog)
Spend caps on agent keys, and an agent buying a capped order itself. Any version needs a custody decision:
a managed wallet, a delegated token allowance, or x402-style per-request payment. Not planned until the owner
decides custody; until then agents are prepaid-only.

### Phase 6: framework recipes
Tested snippets in `services/proxyhubb-mcp/examples/` for LangChain (`langchain-mcp-adapters`), CrewAI, the
OpenAI Agents SDK and n8n (S each). Blocked by: 2.2 (local) or 4.1 (hosted).

### Server fixes this plan depends on (separate tickets)
- Offline nodes shown as purchasable; `list_regions` should count nodes online now.
- Refresh a listing's ISP from the node's measured network (stale Starlink label).

## 6. Decision log

| # | Decision | Recommended | Answer |
| --- | --- | --- | --- |
| Q1 | Build Phase 0 before the submission? | Yes: MCP-only, no deploy | **yes** (2026-11-03) |
| Q2 | Credential for everyday users | New `orders:use` scope + "AI agents" page | **yes** |
| Q3 | Publish npm package + Claude Desktop extension (needs the owner's npm account) | Yes, after the submission | **yes** |
| Q4 | Hosted MCP: when and where | After the submission, on the existing VM behind Caddy, key auth first, OAuth next | **yes** |
| A1 | Credentials stay server-side by default | New tools (from 0.1) never return credentials; making the existing tools omit `proxy_url` by default is a breaking change, so it ships with the Phase 2 package release | assumed |
| A5 | Phase 0 granularity | One PR for the three Phase 0 steps plus this plan (one package, small steps); later phases one PR per step | decided |
| A2 | Agents stay prepaid-only (no buying) | Yes, until Phase 5's custody decision | assumed |
| A3 | `fetch_url` targets | Any public HTTPS site, with size/rate caps and SSRF guard; optional per-key allowlist | assumed |
| A4 | Hackathon scope | Only Phase 0 before Nov 5 02:00 UTC; everything else after | assumed |

## 7. Not yet specified

- Phase 2: package name (`proxyhubb-mcp` vs a scoped `@proxyhubb/mcp`) and who owns the npm account.
- Phase 3.4 and Phase 5: fog, researched at pickup.
- Phase 4: hosting cost and disk on the VM (84% used after the last deploy); whether `mcp.` gets its own container.
- Phase 4.3: whether ChatGPT's current plan rules let a personal account add a custom connector; to be confirmed from OpenAI's own docs at pickup.

## 8. Always / Never

- **Always:** verify the exit before interpreting anything; keep refusal codes honest; caps on every request; tests with each step; one PR per step; DCO sign-off.
- **Never:** fund escrow or sign transactions from the MCP server; weaken `direct_egress` or the satellite rule; return credentials from a new tool; ask users to copy tokens from DevTools once 1.2 lands; deploy in the last hours before the deadline.

## 9. Progress

| Phase | Status |
| --- | --- |
| 0 hackathon-safe | built 2026-11-03 on `feat/mcp-phase0` (0.1 `fetch_url`, 0.2 hint, 0.3 quickstarts): 45/45 tests, typecheck clean, tunnel checked against real HTTPS sites through a local CONNECT proxy. Not yet run through a live order or inside a chat client |
| 1 credentials | not started |
| 2 install | not started |
| 3 tools | not started |
| 4 hosted | not started |
| 5 payments | fog |
| 6 recipes | not started |
