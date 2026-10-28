# ProxyHubb Explorer

Independent public frontend for `https://explorer.proxyhubb.com`. It shares semantic design tokens with the workspace and links back to `https://proxyhubb.com/app` and Docs. It contains no wallet adapters or private account client.

## Validate before release

Use Node 22 or later:

```sh
npm ci
npm audit --omit=dev --audit-level=high
npm run typecheck
npm test
npm run build
npx playwright install chromium webkit
npm run test:e2e
```

The browser checks cover typed lookup, About, reciprocal links, theme persistence and System mode, narrow-screen analytics, and rejection of invalid public requests. API projection tests check that private identities, raw payloads, credentials, and personal balances remain excluded.

## Cloud release

Run the repository's **Deploy** workflow with `services=explorer` and `deploy_explorer=true` at the reviewed source revision. GitHub Actions runs the validation gates, builds the Linux image, and transfers it to the existing GCE VM. The roll script checks the image's source revision and rolls only the Explorer service. No local Docker daemon is required.

| Setting | Value / purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Build-time workspace origin, `https://proxyhubb.com` |
| `API_URL` | Server-only public API upstream, `http://control-api:8080` in the cloud network |
| `EXPLORER_BUILD_REVISION` | Image revision exposed by `/api/health` |
| Listener | `127.0.0.1:4012` on the VM; Caddy serves public HTTPS |

The Cloudflare `explorer` A record must point at the current VM address. Caddy's host block is validated before reload. The deployment then verifies HTTPS, the exact revision, six public page routes, and the public metrics adapter. The health endpoint describes the frontend process; upstream data availability remains a separate state.

Release records and the rendered Compose overlay are saved on the VM in `/opt/proxyhubb/frontend-releases/explorer-<revision>/`. A failed service or Caddy check restores the previous Explorer image and Caddy configuration. Existing workspace, Docs, and backend services are not part of this roll.

## Data boundaries

`/api/public` accepts only the fixed resource list and GET requests. It validates identifiers, bounds pagination, drops incoming cookies and authorization, and projects allowed public fields. Source failures are shown as unavailable; they are not converted into healthy states or reported zeros. Personal proxy credentials and platform balances do not belong in public links.
