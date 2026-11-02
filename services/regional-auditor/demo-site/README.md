# Controlled demo site for live audits (deployable, not deployed)

A live regional audit needs a **public HTTPS site you control**. This is a small, stateless
Cloudflare Worker that behaves differently by the visitor's country, using the country
Cloudflare itself reports, so the seeded defects appear for real Ghana and US exits:

| Version (`SCENARIO`) | Ghana visitor | US visitor |
| --- | --- | --- |
| `demo-v1` | signup button hidden under a cookie banner | shown the Ghana price (GHS) instead of USD |
| `demo-v2` | healthy | healthy |

Every page says it is a synthetic demo. The worker is GET-only, keeps no state, collects
nothing, sets `noindex`, and never caches (so a Ghana page cannot be served to the US).
It is rendered by the same code as the local fixture harness, so what you rehearse locally
is what is served here.

## Deploy (you do this; nothing in this repository does)

Requires a Cloudflare account (the free plan is enough) and your decision to publish.

```bash
cd services/regional-auditor/demo-site
npx wrangler login
npx wrangler deploy                     # serves demo-v1 at https://proxyhubb-regional-auditor-demo.<you>.workers.dev
```

Then tell the auditor it may visit it (this is the only origin it will accept):

```bash
node scripts/stack.mjs live --api-url https://api.proxyhubb.com \
  --target https://proxyhubb-regional-auditor-demo.<you>.workers.dev
```

## The demo's "fix and rerun" step

```bash
npx wrangler deploy --var SCENARIO:demo-v2    # the fixed site
```

Then press **Rerun and compare** in the audit. Resolved findings appear only for regions
whose exits were verified in both runs.

## Things to know

* `request.cf.country` is Cloudflare's classification of the visitor's IP. The auditor
  verifies the exit with its **own** GeoIP source. If the two disagree about an exit, you will see
  the audit report what the site actually served (accurate) next to the auditor's verdict on the exit.
  That is a feature, not a bug, but expect it when rehearsing.
* Unknown or Tor visitors (`XX`, `T1`) get no country-specific behaviour.
* Remove the worker when the demo is over: `npx wrangler delete`.
