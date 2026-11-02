# ProxyHubb Regional Auditor (worker)

A bounded browser worker that checks an authorized website through regional
ProxyHubb exits, collects browser evidence (screenshots, DOM observations,
requests), has Meta's model compare that evidence with what the user expects,
and stores an inspectable, exportable report.

Full documentation, architecture, setup, evaluation and limitations:
[`docs/hackathon/REGIONAL_AUDITOR.md`](../../docs/hackathon/REGIONAL_AUDITOR.md).

## Quick start (fixture mode, no ProxyHubb session needed)

```bash
cd services/regional-auditor
npm install
export AUDITOR_SERVICE_SECRET=dev-only-secret-change-me-0123456789abcdef   # development value only
export AUDITOR_FIXTURE_ENABLED=1        # starts the demo site + local fixture proxy (never in production)
export MODEL_API_KEY=...                # optional; without it the report says "AI analysis not run"
node src/server.ts                      # listens on 127.0.0.1:4021
```

PowerShell: `$env:AUDITOR_SERVICE_SECRET = "..."` instead of `export`.

Then start the web app with the **same** `AUDITOR_SERVICE_SECRET` and `AUDITOR_URL=http://127.0.0.1:4021`
and open **Connections → Audits** (`/app/connections?tab=audits`).

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | run the worker (`node src/server.ts`; Node 24 runs TypeScript directly) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | unit + integration tests (the integration tests launch real Chromium against the local fixture harness) |
| `npm run eval` | run the labelled evaluation cases (uses the real model when `MODEL_API_KEY` is set) |
| `npm run preflight -- --api-url <control API> --regions GH,US` | read-only check of every live prerequisite, naming the variable to fix |
| `npm run inspect -- [aud_id \| latest]` | plain-text summary of a stored audit (use right after the first live run) |
| `npm run stack -- fixture` / `npm run stack -- live --api-url <API> --target <https origin>` | start worker + web together with a fresh shared secret (live runs the preflight first); you sign in yourself |

`demo-site/` is a deployable Cloudflare Worker version of the demo site for live demos. Nothing here deploys it.

Configuration reference: [`.env.example`](.env.example).
