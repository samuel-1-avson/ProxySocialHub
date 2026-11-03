# Live-day checklist

For getting a real two-region audit, a rehearsal, a video and a submission done before the deadline.
Written 2026-11-02 ~23:00 UTC. The documented deadline is **Nov 4, 9:00 PM ET = Nov 5, 02:00 in Accra**
(Accra is UTC+0, so it is also 02:00 UTC). That is about 51 hours from writing, **and it is not confirmed on
the official portal yet** (Phase 0).

Each phase ends with a **gate**: do not start the next phase until the gate is true. Who does it: **you**
(account, wallet, people, clicks) or **me** (code, checks, drafts).

| When (Accra time) | Phases |
| --- | --- |
| Nov 2 evening | 0 (portal), start recruiting for 1 |
| Nov 3 | 1 supply, 2 orders, 3 demo site, **4 first live run (Ghana is enough to find problems)** |
| Nov 4 morning | 5 fix and rerun, 6 rehearse. **Decision at 09:00: second country or fallback B** |
| Nov 4 afternoon | 7 record |
| Nov 4 by 16:00 | 8 submit (10 hours before the deadline, for slack) |

---

## Phase 0: facts from the portal (you, 30 minutes)

Open the hackathon portal and write down, in `docs/hackathon/SUBMISSION_COPY.md`:

- [ ] The real **deadline and time zone**
- [ ] **Video**: maximum length, file or link, any format rules
- [ ] **Submission fields** and word limits
- [ ] Your **track** (Indie or Startup) and that you are **accepted**
- [ ] Rules about **pre-existing code** and whether the repo must be public
- [ ] The **judging weights** (the 30/25/25/20 split we use came from secondary sources)

**Gate:** you know the deadline and the video limit.

## Phase 1: supply (you)

Judges need two working regions, not 195. Today the live testnet has Ghana only (5 listings, one node online
when last checked). Check at any time, no sign-in needed:

```bash
curl -s https://api.proxyhubb.com/v1/listings/facets
```

**A second country** needs a real person with a real connection there. Rules:

* **Real location.** Do not route a node through a VPN to fake a country: the auditor measures the exit and
  reports what it finds, and the hackathon brief forbids fabricating locations.
* **Residential or mobile broadband.** An exit on a satellite network (for example Starlink) is shown as
  *unverified* and is never interpreted.
* **Windows or Linux** for the provider app. The macOS download is still v1.0.6 (two versions behind).
* The machine must stay **on and online** from the first live run until the video is recorded.

What the friend does (no account needed; you approve):

1. Install (public links; the Provider CLI page needs a login, so do not send them there).
   * **Windows**, in PowerShell: `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://api.proxyhubb.com/v1/cli/install.ps1 | iex"`, then **close PowerShell and open a new window**.
   * **Linux** (64-bit x86): `curl -L -o provider-node "https://api.proxyhubb.com/v1/cli/download?platform=linux&arch=amd64&package_type=daemon"` then `chmod +x provider-node`. There is no Linux ARM build.
2. Run `provider-node pair` (Linux: `./provider-node pair`). It prints a link and a code.
3. **You** open that link while signed in (`/dashboard/provider/pair`) and approve. The node now belongs to your account.
4. In the **Provider workspace → Nodes**, check the node shows **online** and that its **country is the real one**. If the detected country is wrong, do not just overwrite it; find out why.
5. Create a **listing** for the node (small bandwidth, a normal price: current listings are $0.89 to $1.04 per GB).
6. Confirm it appears: the facets call above should now list the new country.

The Accra nodes you already have are your Ghana region; keep one running throughout.

**Gate:** facets lists Ghana **and** a second country, and both nodes show *online* in My nodes.

## Phase 2: orders (you, with your wallet)

The testnet needs an escrow-funded session, and the audit never funds anything. Use orders:

- [ ] Wallet has **devnet SOL**
- [ ] Buy **one small order per region** from the marketplace (an audit moves at most 15 MB per region, so
      the smallest order is plenty for many runs)
- [ ] Wait until each order is **active** (Connections → Access)

**Gate:** two active orders, one per country.

## Phase 3: the demo site (you; 10 minutes)

A live audit needs an HTTPS site you control. `services/regional-auditor/demo-site/` is a small Cloudflare
Worker that behaves differently by visitor country: in `demo-v1`, the signup button is hidden behind a cookie
banner for **Ghana** and the **US** sees the Ghana price. Its seeded differences exist for **GH and US**; a
different second country sees no difference, so the US is the best second region.

```bash
cd services/regional-auditor/demo-site
npx wrangler login
npx wrangler deploy            # serves demo-v1 at https://proxyhubb-regional-auditor-demo.<you>.workers.dev
```

- [ ] Open the URL in a browser: it says it is a synthetic demo
- [ ] Note the URL (it is your `--target`)

**Gate:** the demo site loads.

## Phase 4: first live run (you + me)

Do this **early**, even with Ghana only, so any problem surfaces a day before filming.

```bash
cd services/regional-auditor
npm run stack -- live --api-url https://api.proxyhubb.com --target https://<your-demo-site>
```

It runs the readiness check first, generates a fresh secret (never printed), and starts the worker and the web
app. Then:

1. Open <http://localhost:4011/login> and **sign in with your wallet** (this worked on 2026-11-02).
2. Go to **Connections → Audits**, choose **Live**, keep **Use my funded orders**, pick the two regions, run.
3. Read the result. For each region you want **Verified and captured**. Check the **Model** named on the
   report page: it should be `muse-spark-1.3` (standard mode). If it shows `...-contributor`, the training-data
   mode is on; do not claim "non-training" in the video (see SUBMISSION_COPY).
4. If something is off, `npm run inspect` (in `services/regional-auditor`) prints the latest audit and why.

| What a region shows | Do this |
| --- | --- |
| `unavailable`, `session_escrow_required` | you ran **Open new sessions**; choose **Use my funded orders** |
| `unavailable`, `order_not_ready` or `order_not_active` | wait a minute; check the order is active |
| `unavailable`, `order_region_mismatch` | the order is for another country than the region you picked |
| `mismatch` | the exit really is in another country: a true finding about that node, not a bug |
| `unverified` | no GeoIP answer, or a satellite network, or declared and measured countries disagree |
| `failed`, `direct_egress` | **stop**: the request did not use the proxy; do not film |
| the node is offline | the listing still looks buyable; start the node and retry |

More causes are in `docs/hackathon/REGIONAL_AUDITOR.md` section 13.1.

**Gate:** at least one region shows **Verified and captured** with a model report.

## Phase 5: fix and rerun (you)

```bash
cd services/regional-auditor/demo-site
npx wrangler deploy --var SCENARIO:demo-v2        # the fixed site
```

Then press **Rerun and compare** on the audit. You want **Resolved** findings for regions that were
**verified in both runs**. Put the site back with `npx wrangler deploy --var SCENARIO:demo-v1` to film
again.

**Gate:** a real before and after, with at least one resolved finding.

## Phase 6: rehearse (you; I can time it)

Use the live version of the script in `docs/hackathon/REGIONAL_AUDITOR.md` section 14 (about 3 minutes; trim to
the portal's limit). Do it end to end twice.

- [ ] **Say out loud what is real.** Live exits are real; fixture mode is synthetic and the banner says so
- [ ] **The Audits UI runs on your machine** against the live API, not on proxyhubb.com (the worker is not
      deployed on the server); say so in one sentence
- [ ] One sentence on what existed before the event (SUBMISSION_COPY section 5)
- [ ] Never show a token, a proxy password or a secret (the stack never prints its secret; check the
      browser tab, terminal and address bar before you hit record)
- [ ] Close notifications; browser window about 1280 wide; both nodes confirmed **online** just before you start

**Decision at 09:00 on Nov 4:** if there is still no second country online with an active order, **use
fallback B**: a live Ghana run, and a second region shown as a clearly labelled synthetic fixture
(sentence in SUBMISSION_COPY section 8). Do not relabel a fixture as live.

## Phase 7: record (you)

- [ ] Record from a **real live run**, in the afternoon when the nodes are most likely to be up
- [ ] Keep one take of the fixture run as a backup, **labelled as a fixture**
- [ ] Save the audit's exported HTML report next to the video (it is sanitised)
- [ ] Windows built-in recorder: Win + Alt + R starts and stops it

## Phase 8: submit (you, by 16:00 Nov 4)

- [ ] Fill every `[[FILL IN]]` in `SUBMISSION_COPY.md` or delete the sentence it sits in
- [ ] Paste into the portal's fields; attach the video, repository link and the assets listed in section 11
- [ ] Re-read once for any claim the live run did not earn
- [ ] **You** press submit and accept the portal's terms; nothing here does that for you

---

## Do not

* Do not audit a site you do not own or have permission to test.
* Do not fund sessions through the MCP server for the demo; the web flow (orders) is the supported path.
* Do not edit a node's country to match what you wish it were.
* Do not film a region whose assurance is anything other than **Verified**.
* Do not deploy to the server in the last hours unless something is broken: every deploy is a risk, and
  the live site is already healthy.

## If something breaks on the day

1. Run the read-only checks I used (facets call above; `docs/hackathon/SYSTEM_VERIFICATION_2026-11-02.md`
   lists them). The site, API, gateway and certificates were healthy on 2026-11-02.
2. Ports `4011` (web) and `4021` (worker) must be free before `npm run stack`.
3. If the live path fails and time is short, switch to fallback B or the fixture run, labelled, and say so.
