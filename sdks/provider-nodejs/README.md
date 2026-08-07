# @proxyhubb/provider

Thin npm wrapper that downloads official **provider-cli** and **provider-node**
binaries from `GET /v1/cli/download` and proxies CLI arguments.

`doctor` / `start` / `status` need the daemon — this package downloads both and
sets `PROXYHUB_PROVIDER_NODE` automatically.

```bash
npm install -g @proxyhubb/provider
proxyhubb-provider doctor
# or
npx @proxyhubb/provider join --key <provider_token>
```

| Command | Behavior |
|---------|----------|
| `proxyhubb-provider install` | Force re-download binary, print path |
| `proxyhubb-provider path` | Ensure cached binary exists, print path |
| `proxyhubb-provider …` | Forward args to `provider-cli` |
| `proxyhubb-provider --daemon …` | Forward to `provider-node` |

Env: `PROXYHUBB_API_URL` (default `https://api.proxyhubb.com`), `PROXYHUBB_CLI_VERSION`.

There is no separate “seller CLI” — sellers are providers. Automate listings with `@proxyhubb/sdk`.
