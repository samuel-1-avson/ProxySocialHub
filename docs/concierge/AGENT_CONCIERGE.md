# Session assistant (agent concierge)

**Date:** 2026-11-03 · **Branch:** `feat/agent-concierge` · **Status:** built and tested locally; not deployed.

A buyer describes the proxy session they need in their own words. A Meta model drafts the
session, deterministic code checks every value against the rules and today's active listings,
and the buyer approves the result. Nothing is created, funded or signed until the buyer presses
**Create session**, and that button calls the same `POST /v1/sessions/intent` as the rest of the page.

It lives on `/dashboard/proxy` (Connections → Advanced integrations → Open integration tools),
above the Quick Start buttons. AI agents get the same checker without the model, as the MCP tool
`quote_session` (section 6): the calling agent already writes structured arguments, so it needs
the dry run and the escrow figure, not a drafting step.

## 1. How it works

```
buyer's words ──► POST /api/concierge/draft (signed in, same origin, 20 drafts/user/hour, 300/hour overall)
                    │  1. load active listings (GET /v1/listings)
                    │  2. model drafts strict JSON (muse-spark-1.3, standard mode, reasoning effort low)
                    │  3. checker: lib/concierge-plan.ts
                    ▼
               plan + draft + listings ──► card in the browser
                                            edits are re-checked with the same checker and listings
                                            Create session ──► POST /v1/sessions/intent (the buyer's own token)
```

The model only proposes. The checker decides:

| Rule | Why |
| --- | --- |
| Values outside the allowed sets are dropped; size 5-10,240 MB, time 1-240 min (same as the MCP server) | An injected "give me 10 TB" still ends bounded |
| A country without active listings **blocks** the plan; it is never swapped for another | The gateway can fall back to any healthy node; the buyer should decide, not the assistant |
| A price limit is always sent: the buyer's, or else the most expensive matching listing | Without a listing, escrow **and settlement** are priced at the intent's price limit, else a node price (escrow) or $0.99/GB (`session_intent_state.go`, `session_intent_escrow.go`, `settlement/intent.go`). Sending one makes the cost on the card equal to what escrow locks; the card labels it "Price billed" because usage is charged at that rate, whichever provider carries it |
| A budget becomes a whole-MB cap at the price limit, computed in code (1 GB = 1024³ bytes, as billing) | Escrow can never lock more than the budget |
| A $0 price limit is replaced | The server reads 0 as "no limit" |
| A host on both allow and block lists stays on both | Dropping it from the allow list could empty it, which allows every site |
| `purpose_flag: abusive` blocks the plan | Account takeover, scalping, paywall evasion, mass accounts, attacks |

The buyer's text is never logged. The model is told the request is data, and the buyer cannot
close the data block early; the checker is the real guard either way. Contributor-mode models
(which Meta may train on) are refused unless `CONCIERGE_ALLOW_CONTRIBUTOR_MODE=1`.

## 2. Files

| File | What |
| --- | --- |
| `apps/web/src/lib/concierge-plan.ts` | The checker (pure, no imports) |
| `apps/web/src/lib/server/meta-model.ts` | Text-only Meta Responses client, ported from the Regional Auditor's verified one |
| `apps/web/src/lib/server/concierge-draft.ts` | Prompt, strict output format, listings → market facts, rate limiter, drafting steps |
| `apps/web/src/app/api/concierge/draft/route.ts` | `POST /api/concierge/draft` |
| `apps/web/src/lib/api/concierge.ts`, `apps/web/src/modules/concierge/SessionConcierge.tsx` | Browser client and the card |
| `packages/design-system/concierge.css` | Card styles |
| `apps/web/scripts/concierge-plan.test.mjs`, `concierge-draft.test.mjs` | Unit tests (39) |
| `apps/web/e2e/concierge.spec.ts` | Browser tests (5 mocked + 1 opt-in live) |
| `apps/web/scripts/concierge-eval/` | Evaluation cases and runner |
| `services/proxyhubb-mcp/src/session-plan.ts` | Byte-for-byte copy of the checker for the MCP server; `test/session-plan.test.ts` fails if they drift |
| `services/proxyhubb-mcp/src/tools.ts` (`quoteSession`), `src/server.ts` | The `quote_session` MCP tool |

## 3. Running it

```bash
cd apps/web
npm run test:concierge-plan && npm run test:concierge-draft
npx playwright test e2e/concierge.spec.ts --project=chromium
CONCIERGE_LIVE=1 API_URL=https://api.proxyhubb.com npx playwright test e2e/concierge.spec.ts --project=chromium
MODEL_API_KEY=... npm run eval:concierge -- --repeat 2
```

Server settings: `MODEL_API_KEY` (required; the same key the Regional Auditor uses),
`CONCIERGE_MODEL` (default `muse-spark-1.3`), `CONCIERGE_MODEL_REASONING_EFFORT` (default `low`),
`CONCIERGE_MODEL_BASE_URL`, `CONCIERGE_ALLOW_CONTRIBUTOR_MODE`. Without a key the route answers
503 and the card tells the buyer to use the form; Quick Start is unaffected.

## 4. Evaluation

32 hand-written requests, each run twice against the real model, drafted against one fixed
market (GH $0.89-$1.04, US $2.50, DE $1.80). Categories: clear (8), vague (4), cannot be
expressed (4), country without listings (3), abusive (5), legitimate but sensitive-sounding (3),
prompt injection (3), French and Spanish (2). Raw results: `docs/concierge/eval-results/`.

| | Prompt v1 | Prompt v2 (current, `f4098fd484e9`) |
| --- | ---: | ---: |
| Runs passing every check | 48 / 64 | **64 / 64** |
| Abusive requests flagged and blocked | 12 / 12 | **12 / 12** |
| Legitimate requests wrongly flagged abusive | 0 | **0** |
| Values invented for vague requests | 0 | **0** |
| Latency p50 / p95 | 9.3 s / 16.8 s | 12.6 s / 24.2 s |
| Estimated cost per draft (standard prices) | $0.0052 | $0.0063 |

**What changed between v1 and v2.** Prompt v1 passed all 64 runs on the checks first written.
Reading the drafts by hand found three problems those checks missed; checks were added for them,
which is where v1's 48/64 comes from:

1. In 11 of 64 runs, the "guesses" shown to the buyer included rule consequences ("rotation none,
   because sticky implies one stable exit"), diluting real guesses ("Kumasi is in Ghana, so Ghana was chosen").
2. "Check prices once an hour" became an hourly rotation interval.
3. Text meant for the buyer mentioned internal wording ("not expressible in these fields").

Three rules in the prompt were tightened. v2 passes the stricter checks on every run, and its
guesses read as real choices the buyer can verify. The cost is speed: the model reasons longer,
so the median draft takes about 3 s more.

**Stability.** In v1, 29 of 32 cases gave identical drafts on both runs; the other 3 differed
only in writing rotation as `null` or as its default, which produce the same plan.

**Caveats. Read these before quoting any number above.**

- The same people wrote the assistant, the cases and the expected answers. This measures the
  pipeline on these 32 cases, not general accuracy.
- Two of the checks are text patterns ("guesses are real guesses", "no internal wording"); a
  rephrasing could slip past them. The v2 guesses were also read by hand.
- 64 runs per prompt is small. A 0% false-abuse rate on 52 non-abusive runs does not mean the
  model never over-flags.
- Every case used the same fixed market, not live listings.
- Costs are estimates from Meta's published per-token prices (read 2026-11-01), not a bill.

## 5. Known limits and open points

- **Testnet has no listings right now** (0 on 2026-11-03, after the account wipe). The live
  browser test drafted correctly and blocked the plan with "No active listings in GH right now".
  A demo needs providers to list again.
- **Listing ≠ online node.** The listings API does not say whether a listing's node is online,
  so the card says "active listings", not "live".
- **The price limit is a billing rate, not a routing filter (confirmed 2026-11-03).** The gateway
  picks a node by country, domain, pinned node, ISP and rotation, never by price
  (`registry/provider_selection.rs`), and intent usage settles at the price fixed at creation,
  never the carrying node's price (`settlement/intent.go`). So a provider priced above the limit is
  paid below their price, and a buyer routed to a cheaper provider still pays the limit. The
  assistant's notes and the "Price billed" label say so; the fix belongs in the gateway or
  settlement, not here.
- The rate limiter is kept in memory in the web process, which is fine for the single testnet
  instance; more instances would need a shared store.
- **Deploy:** `docker-compose.yml` passes `MODEL_API_KEY` (default empty) and `CONCIERGE_MODEL`
  into the web container; the key must also be in the VM's `.env`, which compose only uses for
  interpolation.

## 6. For AI agents: `quote_session` (MCP)

A dry run over the same checker, with no model and no account needed. It takes the caps
`create_agent_session` takes plus an optional `budget_usd`, loads up to 100 active listings,
and returns `status` (`ok` or `blocked`), the checked `intent`, `notes` for every change,
`max_escrow_usd`, `matching_listings`, and `create_args`. Passing `create_args` to
`create_agent_session` sends exactly the quoted intent (tested for four argument sets). A blocked
quote returns no `create_args`. Out-of-range caps are clamped with a note rather than rejected,
so an agent learns the limits from one call.

Why a copy and not an import: the web app is not an ES module package, so under the MCP server's
`NodeNext` settings the web file typechecks as CommonJS and fails. The copy is checked
byte-for-byte by a test; to update it, copy the web file over again.

Checked: 52 MCP tests and its typecheck pass, and the real server, started over stdio against
`api.proxyhubb.com`, lists the tool and answers. With 0 listings on testnet today, it blocks
with "No active listings in GH right now", as it should.
