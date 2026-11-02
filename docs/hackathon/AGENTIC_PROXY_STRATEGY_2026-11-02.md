# ProxyHubb — Honest Assessment & Agentic Strategy

**Date:** 2026-11-02 · **Status:** Approved by owner 2026-11-02 — build started.
`proxyhubb-mcp` v0 shipped (see §9 progress); Horizon-0 P0 live capture still pending.
**Event:** Meta Global AI Developer Hackathon (Cerebral Valley) — submission listed as
**Nov 4, 2026, 9:00 PM ET = Nov 5, 02:00 Accra** (verify on the official portal before relying on it).
That is roughly **60 hours from now**. Every recommendation below is sized against that clock.

> **One-line verdict:** Your instinct is right and the timing is real — AI agents are becoming
> the fastest-growing buyers of residential proxies. But do **not** build "a platform to run
> multiple agents." Build the **agent-facing supply layer** on top of what you already have:
> an MCP server + rotating/geo session policies + budget-capped machine keys, with the
> Regional Auditor as reference agent #0. Most of the primitives already exist in your SDK.
> For the hackathon, the biggest points are not in new code — they are in one live
> two-region demo and a tight video.

---

## 1. What you said, restated precisely

1. **ProxyHubb today:** a marketplace where people sell their own bandwidth/proxies directly
   to buyers and keep (nearly) all the money, instead of contributing to a centralized
   proxy company that keeps most of it.
2. **The new idea:** AI agents now roam the internet doing research, scraping, and browsing.
   They need **proxy rotation** (avoid rate limits/bans), **geographic exits** (see the web
   as a user in Ghana, the US, etc.), and **many concurrent identities**. ProxyHubb should
   serve those agents — an "agentic part of the system."
3. **The ask:** honest assessment of what exists, whether the agentic layer improves
   hackathon scoring, and exactly how to go about it — as a reviewable plan before building.

Everything below answers those three points with evidence from this repository and the market.

---

## 2. What you have actually built (verified in this repo)

This is not a prototype. It is a large, real platform: **3,253 tracked files**, deployed
testnet at `proxyhubb.com` / `api.proxyhubb.com`, buyer endpoint `proxy.proxyhubb.com:8090`.

| Layer | What exists | Why it matters for agents |
| --- | --- | --- |
| Marketplace | Listings, catalog, offers, orders, reviews, map discovery (`apps/web`) | Supply discovery by region/price/health already works |
| Settlement | Solana Anchor escrow: fund → meter → pay provider → refund remainder → close (`services/solana-programs`) | Trustless pay-per-use; no custodial balance for wallet users |
| Data plane | Rust edge gateway (CONNECT/SOCKS5 + HMAC), Rust provider daemon, Yamux/QUIC tunnels | Real traffic path, not a mock |
| Control plane | Go `control-api`: sessions, orders, bulk pools, subscriptions, disputes, gateway operators | The APIs an agent layer would wrap already exist |
| Buyer SDKs | Node, Python, Go (`sdks/`) with `target_geo`, `rotation_type`, `rotation_interval_seconds`, `sticky`/`rotating` pools, `max_price_per_gb`, `allowed_domains`/`blocked_domains` | **Rotation + geo + budget + domain policy are already in the session-intent contract** |
| Machine access | Scoped API keys (`phub_…`, `proxy:read`/`proxy:write`), bulk pools (`/v1/bulk/pools`) | Agents can already authenticate without a browser |
| Provider side | CLI one-liner onboarding, tray app, heartbeats, per-session earnings, Paystack GHS cash-out path | Supply can come from ordinary people, incl. Ghana |
| Regional Auditor | `services/regional-auditor/` + Audits UI (uncommitted, other chat): Chromium per region through ProxyHubb, observed exit IP, Meta model analysis with evidence validation, rerun/compare, export | **Your first agent that consumes geo proxies** — complete locally on fixture/replay + real Meta analysis; live two-region capture not yet done (see `docs/hackathon/REGIONAL_AUDITOR.md` §2, §13) |
| Agent marketplace (old) | `services/control-api/internal/api/agents.go`: rent Docker-image "MarketAgents", queue jobs via Redis | Different idea (agents *for* humans). Not the new direction — see §5.3 |

**Honest strengths:** end-to-end money + traffic path, metric-honesty discipline
(measured vs. unmeasured is labelled), pre-purchase provider privacy, serious
security/audit history, multi-language SDKs.

**Honest weaknesses (judges or users will find these — better we say them first):**

- **"Provider gets everything in full" is not literally true, and shouldn't be.**
  `incentives.go` records a 5% protocol fee (`defaultFeeBPS = 500`, "observe accounting
  only" today; on-chain collection needs a program upgrade per `escrow.go`/`usage.go`).
  A platform that takes 0% forever cannot pay for gateways, support, or abuse handling.
  The true claim is *stronger* anyway — see the math in §3.2. Say "~95% to the provider,
  price set by the provider, settled on-chain." Never promise 100%.
- **"Decentralized" is partial.** Settlement and registry are on-chain; the control API,
  gateway operation, and Google-sign-in custodial wallets are platform-operated (your own
  README says this honestly — keep that). Say "open marketplace + on-chain settlement."
- **Geo is best-effort today.** The gateway can silently fall back to any healthy node when
  the requested country has none (`REGIONAL_AUDITOR.md` §5.2). The Auditor defends itself by
  *observing* the exit and refusing mismatches. For agents this must become an explicit
  opt-in `strict_geo` product feature, not a silent behaviour.
- **Pool size is small** vs. incumbents advertising 150–400M IPs. You cannot win a
  "biggest pool" contest in 60 hours or 60 days. Win elsewhere (§4).
- **Solana friction:** most agent developers (LangChain/CrewAI world) have an API key and a
  credit card, not SOL. Your Paystack/GHS and managed-wallet path helps humans; agents need
  pre-funded, capped machine budgets (§6.3).
- **Scope sprawl:** social, governance, jury disputes, agent marketplace, explorer, ZK
  provers… Judges reward one sharp story. Everything not on the demo path is a liability
  in a 3-minute video, however good the code is.

---

## 3. Is the agentic idea real? Market evidence

Yes — and it is moving faster than most people think. (Sources linked in §11;
vendor numbers are marketing claims, treated as directional, not audited fact.)

### 3.1 Agents are becoming the proxy customer

- Oct 2026: Oxylabs, Decodo, Webshare, ScrapingBee and Honeygain grouped under one parent
  ("Source", reported $3.6B valuation), publicly citing **AI-agent demand up ~4× in a year**.
- Bright Data reportedly passed **$300M ARR (Nov 2025), more than doubling in a year**,
  driven by AI data collection; AI crawlers now generate multiples of search-crawler traffic.
- Web-scraping market: ~$1.03B (2025) → ~$2.23B (2030) per Mordor Intelligence (via secondary reporting).
- Every serious vendor now ships agent surfaces: Bright Data's public **MCP server**
  (Aug 2025) and Scraping Browser for Puppeteer/Playwright; Oxylabs/Decodo agent positioning;
  Apify's MCP hosting with pay-per-event billing.
- **Agent-native payments are emerging but not settled:** Bright Data has an *open RFC*
  (Mar 2026, `brightdata-mcp#126`) to add per-call x402/MPP payment gating to its MCP server;
  Apify, ZenRows and smaller players (e.g. Proxies.sx, x402-on-Solana scrapers) are
  experimenting. Nobody owns "the agent pays the human provider directly" yet.
  That gap is exactly where a Solana-escrow marketplace has a credible wedge.

**Translation for ProxyHubb:** you are not inventing a demand that doesn't exist, and you are
not too late — but incumbents are shipping MCP now. The window is months, not years.

### 3.2 The provider-pay gap is your sharpest weapon

Residential traffic sells to buyers at roughly **$4/GB promo – $8/GB list** (Bright Data tier).
The human whose IP carries that traffic typically receives:

| Channel | Provider receives | Buyer pays (indicative) | Provider share |
| --- | --- | --- | --- |
| Honeygain | ~$0.10 / GB | (sold via network partners) | ~1–3% of retail value |
| Pawns.app | ~$0.20 / GB | — | ~3–5% |
| EarnApp (Bright Data) | up to ~$0.25 / GB (US IPs) | $4–8 / GB | ~3–6% |
| **ProxyHubb at e.g. $3/GB, 5% fee** | **$2.85 / GB** | **$3.00 / GB** | **95%** |

Even if ProxyHubb providers undercut incumbents at $1.50/GB, a provider earns **7–14×**
what the bandwidth apps pay, while the buyer still pays less than half the incumbent promo
price. That is the honest version of "you get everything": *the spread that used to fund a
middleman now funds the provider and discounts the buyer.* Use this table (with sources and
"indicative" labels) in the pitch — judges remember one number: **$0.10 vs $2.85**.

### 3.3 What agents actually need (your feature checklist)

From vendor docs and agent-framework practice, an agent buyer needs, in order:

1. **One endpoint, policy in the credential/session** — country/city, sticky vs. rotating,
   rotation per-request or per-task. Agents do not browse a marketplace UI per task.
2. **Browser-ready transport** — Playwright/Puppeteer `proxy:` config that just works (CONNECT + auth challenge).
3. **Verified exit** — proof the request really exited in the claimed country, per session.
4. **Budgets & safety rails** — max $/task, max GB, allowed domains, kill switch. An agent
   with an uncapped wallet is a liability story, not a feature.
5. **Machine discovery & payment** — MCP tools today; x402-style per-call payment tomorrow.
   No human signup flow per agent deployment.
6. **Receipts** — per-task usage + cost an owner can audit. (Your escrow + metering already gives this.)

Your session-intent contract already expresses 1, 4 and part of 3. The work is packaging,
not invention — which is why this is feasible at all near a deadline.

---

## 4. Competitive position — where you can and cannot win

| Dimension | Incumbents (Bright Data / Source group) | Bandwidth apps (Honeygain, Grass…) | ProxyHubb |
| --- | --- | --- | --- |
| Pool size | 150–400M IPs claimed | Large, opaque | Small — **do not compete here** |
| Provider pay | $0.10–0.25/GB via apps | Same apps | **~95% of sale price — win** |
| Long-tail geos (e.g. Ghana, West Africa) | Thin, expensive | Whatever installs exist | **Recruit locally, be the best GH/Africa pool — winnable** |
| Verified exit | Trust the vendor | N/A | **Observed-exit proof (Auditor tech) — win** |
| Agent DX | MCP shipped, payments still account-based | None | MCP not yet shipped; **wallet/escrow-native payment — potential win** |
| Price transparency | Opaque tiers, sales calls | Provider price invisible | **Provider-set, on-chain settled — win** |
| Compliance/KYC | Mature, strict | Light | Must build (§7) — currently behind |

**Positioning sentence (use everywhere):**
*"ProxyHubb is the open proxy network for AI agents: agents get verified residential exits
in the countries they need, and the people in those countries keep ~95% of what the agent pays —
settled per task on Solana."*

Note what this sentence does: buyer = agent (Meta-hackathon-relevant), differentiator =
verified + provider share, geography = your home advantage, Solana = payment rail, not the headline.

---

## 5. The critical correction: what "agentic part" should mean

### 5.1 ❌ Do not build: a platform where people run/host multiple agents

Tempting, and a trap. Agent runtimes (LangGraph, CrewAI, Meta's own stack, countless
hackathon entries) are a red ocean; hosting arbitrary agents means sandboxes, secrets,
billing for compute, and support — none of which uses your moat (supply of residential IPs +
settlement). In 60 hours it would be an unfinished demo that *lowers* your score.

### 5.2 ✅ Build instead: the supply layer every agent framework plugs into

```
 Any agent (LangChain / CrewAI / Playwright / your Regional Auditor)
        │  MCP tools  │  SDK  │  plain proxy URL
        ▼
 ┌─────────────────────────────────────────────────┐
 │ ProxyHubb Agent Sessions (NEW thin layer)        │
 │ policy: {countries, rotation, sticky, max_$/task,│
 │          allowed_domains, verified_exit_only}    │
 │ machine key phub_… with budget cap · receipts    │
 └──────────────┬──────────────────────────────────┘
        existing ▼ session-intent → gateway → provider-node → escrow settle
 Providers (people) earn ~95%, per task, on-chain
```

You stay the network + market. Frameworks bring the agents. The Regional Auditor becomes
**reference agent #0** — living proof, already ~built, that a Meta-model agent needs exactly this.

### 5.3 What to do with the old `agents.go` marketplace

Nothing, visibly. It rents Docker-image agents to humans; it is not on the demo path and its
name now collides with the new story. Recommendation: leave the code, remove it from pitch/UI
emphasis, and post-hackathon either delete it or rename to avoid confusion. Do not spend
one hackathon hour on it.

---

## 6. Proposed build: ProxyHubb for Agents (v1)

### 6.1 MCP server — `proxyhubb-mcp` (the headline artifact)

A small TypeScript (or Python) MCP server wrapping existing REST + SDK. Tools:

| Tool | Wraps | Notes |
| --- | --- | --- |
| `list_regions` / `discover_listings` | `GET /v1/listings/facets`, listings search | Returns countries with live supply + indicative price/GB |
| `create_agent_session` | `POST /v1/sessions/intent` | Input: `{country, rotation: per_request\|sticky, sticky_minutes, max_price_per_gb, max_gb, allowed_domains[]}`; output: proxy URL + session id |
| `verify_exit` | Auditor's observe-exit logic (`services/regional-auditor`) | Returns observed IP + GeoIP estimate + `verified\|mismatch\|unverified` — never silent substitution |
| `get_session_usage` | usage/escrow reads | GB used, cost so far, budget remaining |
| `close_session` | session lifecycle | Settles escrow, refunds remainder |
| `run_regional_audit` *(stretch)* | Regional Auditor API | The Meta-model audit as a callable tool — very strong demo beat |

Auth: existing `phub_` API key + pre-funded escrow/budget owned by a human account.
Effort: **~1–2 focused days** for tools 1–5 against the live testnet API; it is a wrapper,
not new infrastructure. Publish as `npx proxyhubb-mcp` + README with Claude/Cursor config.

### 6.2 Framework examples (proof it is generic, not just your Auditor)

Two tiny, runnable examples in `examples/agents/`:

1. **Playwright research agent (Node or Python):** "Compare the signup page and pricing
   currency of *{authorized demo site}* as seen from GH and US" — two sticky sessions,
   screenshots, one paragraph summary. Reuses Auditor capture patterns.
2. **Rotating fetch agent (Python httpx):** fetches N pages from an authorized target with
   per-request rotation, prints exit-IP changes + total cost from `get_session_usage`.

Each example <150 lines. Purpose: a judge can run one command and watch an agent spend
real (testnet) money that lands in a provider's earnings view.

### 6.3 Agent budgets & payments — phased honestly

- **Phase A (hackathon, now):** human owner creates account, funds escrow, issues a scoped
  `phub_` key with caps (`max_price_per_gb`, bytes limit, allowed domains already exist).
  The agent can spend *only inside the cap*. Pitch it as a feature: "agents get an allowance,
  not your wallet."
- **Phase B (post-hackathon spike, 2–4 weeks):** x402 on Solana — agent hits `402`,
  pays USDC per session/GB from its own wallet, no account. Prototype behind a flag;
  Bright Data's RFC shows even the leader hasn't shipped this. **Do not start Phase B before Nov 4.**
  Mention it on one roadmap slide only, labelled as roadmap.

### 6.4 `strict_geo` / verified-exit-only mode (small, high-trust win)

Opt-in session flag: if no node in the requested country, the session fails loudly instead
of falling back (fixes the §2 weakness as a product feature, using the signed session-intent
path the Auditor doc §5.2 already identifies: `token.go` + `session_intent.rs`).
If Go/Rust changes are too risky before the deadline, ship the *client-side* version first
(MCP `verify_exit` + refuse-on-mismatch, exactly like the Auditor) and schedule the
gateway enforcement post-hackathon. Either way: **agents must never be silently exited
in the wrong country** — that sentence is a trust feature competitors don't lead with.

---

## 7. Risks & the abuse question (say this before judges ask)

"Proxies for bots" makes some judges reach for the red pen. You win by being the most
responsible actor in the room, on camera:

| Risk | Honest mitigation (mostly already in your design) |
| --- | --- |
| Scraping abuse, ToS violations, credential stuffing | Authorized-target positioning; `allowed_domains` per session; read-only Auditor; rate/concurrency caps; provider-side blocked categories; abuse reporting + key revocation. Demo **only** on sites you own/are authorized to test (your demo-site Worker exists for this). |
| Provider harm (IP blocklisted, ISP trouble) | Provider opt-in per traffic class, visible earnings/risk, pause anytime, pre-purchase IP privacy (already built). Post-hackathon: per-provider domain blocklists + "agent traffic" tier with premium pricing — let providers price the risk. |
| Geo-circumvention framing | Frame as *regional QA, price research, ad verification, accessibility testing* — seeing your own product as your customers see it. Never demo bypassing a paywall or geo-blocked content service. |
| Money risks (KYC/AML, payouts) | Hackathon scope = Solana testnet + existing Paystack path; no new money features before submission. Mainnet is already scoped as a separate project (`docs/MAINNET_CUTOVER_SCOPE.md`) — keep it that way. |
| Agent overspend | Budget caps per key/session (§6.3 Phase A). Show the cap being enforced in the demo — 20 seconds that buys a lot of trust. |
| Cold start / liquidity | Seed the two demo regions with your own + recruited nodes (friends/teammates in GH + one other country). Judges need 2 working regions, not 195. Post-hackathon: recruit where incumbents are weak and you have community. |
| Live failure on demo day | Fixture + replay modes already exist in the Auditor and are honestly labelled. Record the video from a *real live run captured early*, keep replay as backup — never relabel replay as live. Your metric-honesty culture is an asset; protect it. |

---

## 8. Hackathon scoring: current vs. with the agentic layer

Reported judging weights for this event (secondary sources — **confirm on the official
Cerebral Valley rules page**): **Impact 30% · Creative use of Meta AI 25% · Demo (incl.
video) 25% · Technical depth & execution 20%.**

Estimates below are my judgement of *relative* strength (0–100 per criterion), not a promise.
"Now" = marketplace as-is with no AI layer. "Auditor" = current other-chat build finished
with live capture. "+ Agents" = Auditor **plus** §6.1–6.2 (MCP + one generic example) and
the §4 positioning.

| Criterion (weight) | Marketplace alone | + Regional Auditor (live) | + Agentic layer (MCP) | Why it moves |
| --- | --- | --- | --- | --- |
| Impact (30%) | 55 | 70 | **80** | Story grows from "proxy shop" → "SMBs see their site as customers do" → "every AI agent gets eyes in every country, and people there get paid 95%." The $0.10→$2.85 number lands here. |
| Creative Meta AI use (25%) | 20 | 75 | **80** | Marketplace alone barely uses Meta AI — likely fatal in a Meta hackathon. Auditor's evidence-grounded, validated findings are genuinely creative. MCP adds "Meta-model agents as customers," small extra. |
| Demo & video (25%) | 50 | 75* | **85*** | *Only if live two-region capture works on camera. Side-by-side GH vs US screenshots + "agent paid a provider in Accra $X for this task" receipt is filmable in 3 minutes. Marketplace UI tour is not. |
| Technical depth (20%) | 85 | 88 | **90** | Already your strongest suit (Rust gateway, Anchor escrow, verified-exit). MCP adds breadth, not depth — don't over-invest here. |
| **Weighted estimate** | **~48** | **~76** | **~83** | Directional only. The Auditor does most of the lifting; the agentic layer adds ~5–8 points *if finished*, and subtracts if it ships half-broken. |

**Three conclusions judges would want us to draw:**

1. **The Regional Auditor is non-negotiable.** Without a Meta-AI centerpiece, a proxy
   marketplace — however well engineered — is off-brief for this hackathon.
2. **The agentic layer is a force multiplier, not the foundation.** It converts "one clever
   audit tool" into "a platform thesis about the agent economy," which is exactly what
   Impact (30%) rewards. But a half-finished multi-agent platform would reverse the gain.
   Thin MCP + one example = the right size.
3. **Demo risk dominates everything.** A live GH-vs-other-country run that fails on video
   day costs more than any missing feature. Live acceptance comes *before* MCP in the queue (§9).

**Suggested 3-minute demo script (for our review):**
`0:00` The $0.10 problem (provider pay gap, one slide) → `0:30` "Agents are the new buyers"
(one market stat) → `0:50` Live: ask the Auditor to check an authorized site from GH + US;
watch verified exits, side-by-side screenshots, Meta findings with evidence →
`1:50` Same network, any agent: MCP tool call creates a rotating session, budget cap enforced,
receipt shown → `2:30` Provider view: earnings landed, ~95% of what the agent paid, on-chain
settlement link → `2:50` Roadmap one-liner: x402 agent payments + more regions. Cut everything else.

---

## 9. Roadmap & task backlog (the part we execute together)

### Horizon 0 — Submission sprint (now → Nov 4, 9 PM ET). Freeze everything else.

**P0 — must land, in this order:**

- [ ] **Confirm official facts:** deadline, judging weights, video length/format, track
      (Indie vs Startup), acceptance status — from the Cerebral Valley portal only. *(30 min, you)*
- [ ] **Live acceptance for the Auditor:** signed-in account on the running deployment,
      authorized HTTPS target (deploy `services/regional-auditor/demo-site/`), two real
      regional exits with `verified` assurance, one end-to-end report. Exact prerequisites:
      `docs/hackathon/REGIONAL_AUDITOR.md` §13. **This is the single highest-value task left.**
- [ ] **Seed demo supply:** your GH node + ≥1 node in a second country online during
      recording windows; test `npm run preflight` + a dry-run capture before filming.
- [ ] **Record the demo video** from a real live run (§8 script); keep labelled replay as backup.
- [ ] **Submission copy:** §4 positioning sentence + §3.2 table + honest limits
      (testnet, 2 regions, Phase-A agent budgets). Update README top section only if time allows.
- [ ] **Commit the Auditor work** (currently all untracked/modified in the working tree)
      on its own branch so the submission repo is reproducible. Do not sweep in unrelated changes.

**P1 — only if P0 live capture succeeds with ≥12 hours to spare (timebox hard):**

- [x] `proxyhubb-mcp` v0 **built 2026-11-02** (`services/proxyhubb-mcp/`): tools
      `list_regions`, `discover_listings`, `create_agent_session`, `verify_exit`,
      `get_session_usage`, `close_agent_session` (§6.1) + README. 19 mocked-API tests +
      typecheck pass; live stdio smoke returned real regions (GH×2, US×1). Session
      creation/verify still need a JWT-funded live run as part of P0 acceptance.
- [x] Example agent built: `services/proxyhubb-mcp/examples/mcp-research-agent.ts`
      (MCP-client research-agent skeleton: regions → capped session → verify exit).
      A filmed Playwright variant remains possible if P0 finishes early.
- [ ] 30 seconds of MCP footage inserted into the video; otherwise MCP = one roadmap line.

**Explicitly NOT before submission:** x402, hosting/running user agents, new marketplace
features, mainnet anything, gateway `strict_geo` Go/Rust changes (unless P0 finishes very
early), rebranding, new landing pages.

### Horizon 1 — Two weeks after the hackathon

- [ ] MCP v1 hardening: publish package, error taxonomy, budget-cap tests, Cursor/Claude configs.
- [ ] LangChain + CrewAI integration snippets; "ProxyHubb for Agents" docs page (`apps/docs`).
- [ ] Gateway-enforced `strict_geo` via signed session intent (§6.4) + SDK fields in all 3 SDKs.
- [ ] Provider "agent traffic" opt-in tier + premium pricing knob; per-provider domain blocklist.
- [ ] Recruit 10–20 GH/West-Africa providers; publish live region/price page agents can poll.

### Horizon 2 — 1–3 months (only if Horizon 1 shows agent usage)

- [ ] x402-on-Solana spike → USDC per-session payment, no-account agent onboarding.
- [ ] Per-task receipts API + agent spend dashboard (owner view across keys/agents).
- [ ] Success-based pricing experiments (pay per successful fetch), quality scoring per node for agent traffic.
- [ ] Partnerships: agent frameworks, scraping-browser tools, African dev communities.
- [ ] Revisit fee: keep headline 5% while supply is the constraint; revisit only with data.

**Suggested squad for execution (who/what owns what):** you = official-rules check, supply
seeding, video face/voice, final submission clicks. This/other coding chats = live-acceptance
debugging, MCP v0, example agent, submission copy drafts. No new chat should start Horizon-1
work until Horizon-0 P0 is green.

---

## 10. Decisions I need from you before we build

1. **Direction:** approve "supply layer for agents" (§5.2) over "platform that runs agents" (§5.1)?
2. **MCP scope:** P1-timeboxed for this hackathon, or roadmap-slide-only so all hours go to live capture + video?
3. **Demo regions:** GH + which second country do you actually have (or can get within 24h) a node in?
4. **Fee wording:** okay to standardize on "~95% to providers (5% protocol fee)" everywhere, retiring "everything in full"?
5. **Name consistency:** pitch as **ProxyHubb** (product/domain) with repo **ProxySocialHub** noted once — okay?
6. **Track & acceptance:** which hackathon track were you accepted into (Indie vs Startup), and what does the portal currently show as deadline + video spec?

Answer these in chat (or edit this file inline) and we start at Horizon-0 P0 #2 together.

---

## 11. Sources & evidence notes

Repo evidence (read 2026-11-02): `README.md`; `sdks/nodejs/index.d.ts` (session-intent
fields); `services/control-api/internal/api/bulk.go`, `agents.go`, `escrow.go`;
`services/control-api/internal/incentives/incentives.go` (`defaultFeeBPS=500`);
`docs/hackathon/REGIONAL_AUDITOR.md` (completion states, §5.2 geo fallback, §13 live
prerequisites); `docs/plans/META_HACKATHON_REGIONAL_AUDITOR_EXECUTION_PROMPT_2026-11-01.md`
(event links, listed deadline). Working-tree state via `git status` (Auditor uncommitted).

External (secondary reporting; verify before quoting exact figures publicly):

- Meta Global AI Developer Hackathon — [official event page](https://dev.meta.ai/events/global-hackathon)
  and [Cerebral Valley details](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details);
  reported $1M pool, Oct 26–Nov 4 window, judging weights via
  [MadRobot summary of official rules](https://madrobot.blog/2026/10/03/meta-global-ai-developer-hackathon-1-million-prizes-muse-model-api/).
- "Source" grouping (Oxylabs/Decodo/Webshare/ScrapingBee/Honeygain), ~$3.6B, 4× AI-agent
  demand — trade/secondary reporting, Oct 2026.
- Bright Data ~$300M ARR Nov 2025; residential $4/GB promo / $8 list — secondary market
  reporting and pricing roundups (Proxyway/Plisio and similar), 2025–2026.
- Provider payouts: Honeygain ~$0.10/GB, Pawns.app ~$0.20/GB, EarnApp up to ~$0.25/GB (US) —
  vendor pages and comparison roundups (Mellowtel/Proxies.sx), 2026.
- Bright Data MCP server (Aug 2025) and x402 RFC
  [brightdata-mcp #126](https://github.com/brightdata/brightdata-mcp/issues/126) (Mar 2026);
  Apify MCP + x402/Skyfire billing; Proxies.sx MCP/x402 — vendor docs/GitHub, 2025–2026.
- Web-scraping market $1.03B (2025) → $2.23B (2030) — Mordor Intelligence via secondary reporting.

*Unconfirmed at writing time: official judging weights, exact deadline/timezone on your
portal view, your track/acceptance status, live two-region availability. Each is flagged
as a Horizon-0 task rather than assumed.*
