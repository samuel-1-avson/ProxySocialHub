# Submission copy (draft)

Written 2026-11-02 for the Meta Global AI Developer Hackathon. **Nothing here has been submitted, and
nothing accepts any terms for you.** Rules for using this file:

* Every number below comes from a run or a source named next to it. If you change a number, re-check it.
* `[[FILL IN: ...]]` marks things that depend on work not finished yet (the second region, the video, the
  portal's exact fields). **Delete any sentence that still has a marker when you submit.** Do not leave a
  claim in that the live run did not earn.
* Use the portal's own field names, limits and video rules; this file only supplies the words. The official
  event page (<https://dev.meta.ai/events/global-hackathon>) did not publish a video length or the field
  list when we read it on 2026-11-01.

---

## 1. One line (pick one)

* **Product:** ProxyHubb Regional Auditor: an AI assistant that shows you what your website looks like to
  customers in other countries, with screenshots and evidence you can check.
* **Platform:** ProxyHubb is the open proxy network where the people in a country keep about 95% of what
  buyers pay, now with an AI auditor that proves where each exit really is.

## 2. Short pitch (about 50 words)

Most teams cannot see their website the way customers in Ghana or the US do. ProxyHubb Regional Auditor
opens a browser through real residential exits in each country, checks where each exit really is, and
asks Meta's Muse Spark model to explain what differs, citing the screenshots. Fix the site, rerun, see
what was resolved.

## 3. Medium description (about 170 words)

**The problem.** A site can look fine from the developer's laptop and still hide the signup button
behind a cookie banner in Ghana, or show Ghanaian cedis to US visitors. Small teams cannot see this:
VPN checks are unreliable and no one has a customer's phone in every country.

**What we built.** ProxyHubb is an open proxy marketplace: people sell their own bandwidth and keep
about 95% of the price, settled on Solana (testnet today). The Regional Auditor is the new part. It opens
one isolated Chromium per country through a ProxyHubb exit, **measures the exit IP from the same
browser**, captures screenshots and request evidence, and sends them to Meta's Muse Spark vision model.
The model writes findings; our validator removes any claim the evidence does not support and shows what
it removed. A rerun compares before and after.

**It never trusts routing.** If a request leaves from the wrong country, the audit refuses to interpret
it and says so, instead of presenting a wrong region as a real one.

[[FILL IN: one sentence on the result of the live run, only if it succeeded, e.g. "In a live run through
Ghana and the US the audit found X and the rerun showed it resolved."]]

## 4. Long description (about 450 words)

### The idea
Residential proxies are how you see the web as a person in another country sees it. The big vendors
sell them for roughly $4 to $8 per GB; the people whose connections carry the traffic reportedly get
cents. ProxyHubb is a marketplace where the provider sets the price, keeps about 95%, and is paid
per use through an on-chain escrow. The Regional Auditor is the first "agent" that buys from it.

### How the Regional Auditor works
1. You enter an HTTPS site you are allowed to test, pick up to two countries and say what should be true
   ("signup is usable, prices are in the right currency").
2. **Plan.** Meta's model turns that into at most six read-only checks from a closed list; anything else
   is dropped.
3. **Capture.** A separate Chromium per country, forced through that country's ProxyHubb session. The
   browser measures its own exit IP before and after loading the site, looks the IP up, and compares it
   with the country requested and the country the provider declared. Only a route that **verifies** is
   interpreted. Mismatch, unknown, direct-connection and unavailable routes are reported as such.
4. **Analysis.** Screenshots and sanitised page evidence go to Muse Spark. Its output must follow a
   strict JSON schema; our validator then deletes unknown evidence references, drops findings with no
   valid evidence, downgrades a claimed defect the recorded facts cannot support to a *hypothesis*, and
   records every change on the page.
5. **Rerun and compare** shows resolved, persisting, new and not-comparable findings, and exports a
   sanitised HTML or JSON report.

### How we use Meta AI (for the "creative use" criterion)
* Two stages with different jobs: a *planner* that is not allowed to invent actions, and a *vision
  analyst* that has to cite evidence.
* Page text and screenshots are treated as untrusted. Two of our 15 evaluation cases contain
  prompt-injection text; neither fooled the model.
* The model is asked to separate **observed defects** from **regional differences that may be
  intentional** and from **hypotheses**, and to state uncertainty in words, not numbers.
* Default is the *standard* (non-training) Muse Spark mode; the training-data ("contributor") mode is
  refused unless explicitly enabled. Requests are sent with `store: false`.
  **[[CHECK before you keep this bullet: the 2026-11-02 live report shows model
  `muse-spark-1.3-contributor`, so that stack had contributor mode enabled. Confirm the stack you record
  with uses `muse-spark-1.3` (the report page names the model). If it does not, delete "standard
  (non-training)" from every place it appears.]]**
* Measured cost: about **$0.017 per two-region audit** (estimate from the documented Muse Spark prices).

### Measured results (synthetic evaluation, be careful how you quote it)
| Run | Seeded defects found | False alarms on healthy controls | Median job time |
| --- | --- | --- | --- |
| 4 passes, 60 runs, 2026-11-01 | **44 / 44** | **0 / 24** | 10.9 s |
| Fresh pass, 15 cases, 2026-11-02 | **11 / 11** | **0 / 6** | 12.1 s |

This is a smoke test of the pipeline and its guard rails, **not** a claim of general accuracy: the same
people wrote the demo site, the defects and the labels. The raw results are in
`docs/hackathon/eval-results/`.

### Live evidence
* One real audit through a Ghana marketplace order (`aud_a397dd463c47`, 2026-11-02): the exit was
  observed, verified as Ghana, captured, and analysed by the model.
* [[FILL IN: the second region and the before/after rerun, **only if they happened live**. Otherwise
  delete this line and use the fallback sentence in section 8.]]

### Also in the submission
`proxyhubb-mcp`, a small MCP server so any agent can discover regions and request capped, verified
sessions. Its read tools are proven against the live API; session creation follows the same escrow rules
as the web app and was **not** exercised live.

## 5. What is new and what existed before (say this plainly)

ProxyHubb is not a hackathon-weekend project and we do not present it as one. `main` has 786 commits
since 2026-01-16.

**Existed before this event:** the marketplace, wallet and escrow on Solana, the Go control API, the Rust
edge gateway and provider node, the buyer SDKs, the provider app and CLI, the web workspace and design
system.

**Built for this event** (committed 2026-11-02 in PRs #126 to #131; see `git log`):

| What | Where |
| --- | --- |
| The Regional Auditor worker (browser capture, route verification, Meta client, validation, stores, fixtures, evaluation): 58 files, about 9,100 lines | `services/regional-auditor/` |
| The web side (authenticated routes, the Audits UI, report pages, rerun comparison, export) and migration 000176 | `apps/web/src/app/api/audits/`, `apps/web/src/modules/audits/`, `migrations/` |
| `proxyhubb-mcp`: 15 files, about 1,400 lines | `services/proxyhubb-mcp/` |
| An honest proxy connection test (it used to report "Synchronized" without touching the gateway) | `apps/web/src/app/api/proxy/test/` |
| Fixes found while building it: a Ghana node was counted and pinned as US; the Buy dialog could not connect a wallet; exits on satellite networks are never "verified"; security headers on the site | PRs #126, #128, #130 |
| A full-system verification record | `docs/hackathon/SYSTEM_VERIFICATION_2026-11-02.md` |

## 6. The pay-gap numbers (read the correction)

Reported figures (vendor pages and comparison sites, 2025 to 2026; **indicative, not audited**; see
`docs/hackathon/AGENTIC_PROXY_STRATEGY_2026-11-02.md` section 11 for sources):

| Channel | Provider reportedly receives per GB |
| --- | --- |
| Honeygain | about $0.10 |
| Pawns.app | about $0.20 |
| EarnApp | up to about $0.25 (US IPs) |
| Large vendors' residential price to buyers | about $4 to $8 per GB |

**Correction to the strategy doc.** It uses an example price of $3/GB to reach "$0.10 versus $2.85". The
live testnet listings are priced **$0.89 to $1.04 per GB**. At the designed 5% fee the provider keeps
about **$0.85 to $0.99 per GB**, which is roughly **3.4 to 9.9 times** what the bandwidth apps pay.
Quote that. If you want to show the $3 example, label it "illustrative price". Never say 100%.

The 5% fee is recorded as accounting only on testnet today; collecting it on-chain needs a program
upgrade. Say "designed so providers keep about 95%".

## 7. Honest limits (put these in the submission; judges find them anyway)

* **Testnet.** Solana devnet with test SOL. No real money moves. Mainnet is a separate, scoped project.
* **Ghana is the live region.** [[FILL IN or delete: "A second region, X, was live on DATE."]]
* **Fixture mode is synthetic and says so** on every page and export. It is never relabelled as live.
* **The evaluation is small and self-authored** (see section 4).
* **A GeoIP country is an estimate, not proof of location.** The audit shows source and time, and treats
  satellite networks (for example Starlink) as unverified because their addresses are placed by ground
  station.
* **Small network.** Very few nodes are online at once (one Ghana node when we last looked, 2026-11-02);
  we do not compete on pool size.
* **The Audits UI runs from a local stack** against the live API today; the worker is not deployed on
  the public server.
* **Agent budgets are caps on a user's own session, not a payment protocol** (x402 and similar are on the
  roadmap, not built).

## 8. The live-demo sentence (two versions)

* **A. Two regions live:** "This run goes through real ProxyHubb exits in Ghana and [[COUNTRY]]. Each
  exit's IP is measured by the browser itself and checked before anything is interpreted."
* **B. Fallback, Ghana live only:** "The Ghana run is live through a real ProxyHubb exit. The second
  region is a labelled synthetic fixture, because we do not yet have a second country online." Say it out
  loud and keep the on-screen "Synthetic fixture" banner visible.

## 9. Abuse and ethics (answer it before they ask)

Frame it as regional QA, price and currency checks, accessibility and ad verification: seeing **your own
site** the way your customers do. The auditor is read-only, bounded (at most 2 regions, 6 checks, 15 MB per
region), and only visits origins on an allow-list. We demo only on a site we control. We never demo getting
around a paywall or a geo-blocked service. Providers opt in, see their earnings, and can pause at any time.

## 10. Questions judges may ask

| Question | Honest answer |
| --- | --- |
| Is this just a proxy marketplace? | The marketplace existed before. The new part is the verified-exit audit with Meta's model, and an MCP server so agents can use the network. |
| What did you build during the event? | Section 5. Everything else predates it, and the repo history shows it. |
| Does it work live? | One real Ghana audit, yes. [[FILL IN the second region.]] Fixture mode is labelled synthetic. |
| How accurate is the AI? | On our 15-case synthetic suite it found 11 of 11 seeded defects with no false alarms on the 6 controls. That shows the pipeline and guard rails work; it is not a general accuracy claim. |
| Why not trust the gateway's routing? | It can fall back to any healthy node when a country has none. So we measure the exit instead, and refuse mismatches. |
| Why Solana? | Providers are paid per use from an escrow, so no one holds a custodial balance; it is the settlement rail, not the headline. |
| What does it cost? | About $0.017 per two-region audit in model usage (estimate). |
| What stops misuse? | Section 9. |

## 11. Assets to attach

* Video: [[FILL IN: URL, after recording; use the portal's length and format]]
* Repository: [[FILL IN: URL]]; start at `docs/hackathon/REGIONAL_AUDITOR.md`
* Screenshots from the full-stack run: `docs/hackathon/screenshots/` (**synthetic fixture evidence**, real
  UI and real model: label them that way)
* Evaluation raw results: `docs/hackathon/eval-results/`
* Verification record: `docs/hackathon/SYSTEM_VERIFICATION_2026-11-02.md`
