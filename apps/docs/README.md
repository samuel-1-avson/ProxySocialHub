# ProxyHubb docs

Public documentation for **https://docs.proxyhubb.com** (Next.js + MDX).

## Local

```bash
cd apps/docs
npm install
npm run dev   # http://localhost:3010
```

`predev` / `prebuild` sync OpenAPI (when `docs/openapi.yaml` is available) and regenerate `public/search-index.json`.

### MDX components

Content files under `content/` are compiled as MDX. Available components:

- `<Callout type="info|tip|warning|danger" title="…">…</Callout>`
- `<Steps>` / `<Step title="…">…</Step>`

### Optional analytics

Set `NEXT_PUBLIC_PLAUSIBLE_DOMAIN=docs.proxyhubb.com` to load Plausible.

## OpenAPI sync

Authoritative contract: `docs/openapi.yaml`  
Published copy: `apps/docs/public/openapi.yaml`

```bash
# from repo root
./scripts/sync-docs-openapi.sh

# or from apps/docs
npm run sync:openapi
```

Deploy (`scripts/gcp-deploy-docs.sh`) runs the sync before `docker compose build docs`.

API reference uses a **self-hosted, version-pinned** Scalar browser bundle (`public/vendor/`, fetched by `npm run vendor:scalar`). Theme follows the docs light/dark toggle.

## Deploy (GCP)

```bash
./scripts/gcp-deploy-docs.sh
```

Host port **3010** → Caddy `docs.proxyhubb.com` (see `config/gcp/Caddyfile.example`). Healthcheck probes `/docs`.
