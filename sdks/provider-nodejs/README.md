# @proxyhubb/provider

Thin npm wrapper that downloads official **provider-cli** and **provider-node**
binaries from `GET /v1/cli/download` (resolves version via `/v1/cli/downloads/latest`)
and proxies CLI arguments.

Always fetches the current latest (or `PROXYHUBB_CLI_VERSION`) and extracts `.zip`
archives when the API returns one — so Windows installs stay runnable.

```bash
npm install -g @proxyhubb/provider
proxyhubb-provider install          # force re-download 1.0.5+ binaries
proxyhubb-provider --daemon doctor
proxyhubb-provider --daemon start
# or
npx @proxyhubb/provider --daemon join --force --api-key <token> --node-id <node_id>
```

| Command | Behavior |
|---------|----------|
| `proxyhubb-provider install` | Force re-download binaries, print path(s) |
| `proxyhubb-provider path` | Ensure cached binary exists, print path(s) |
| `proxyhubb-provider …` | Forward args to `provider-cli` |
| `proxyhubb-provider --daemon …` | Forward to `provider-node` |

Env: `PROXYHUBB_API_URL` (default `https://api.proxyhubb.com`), `PROXYHUBB_CLI_VERSION`.

## Rust / cargo

Preferred for production: download the release binary or use this npm wrapper.

From source (requires Rust toolchain):

```bash
cargo install --locked --git https://github.com/samuel-1-avson/ProxySocialHub.git --tag provider-v1.0.5 --path services/provider-node
```

There is no crates.io publish (`publish = false`); use GitHub Releases or `--git` as above.
