# proxyhubb-provider

Thin Python wrapper that downloads official **provider-cli** and **provider-node**
binaries from `GET /v1/cli/download` (resolves version via `/v1/cli/downloads/latest`)
and proxies CLI arguments.

```bash
pip install -U proxyhubb-provider
proxyhubb-provider install
proxyhubb-provider --daemon doctor
proxyhubb-provider --daemon start
```

| Command | Behavior |
|---------|----------|
| `proxyhubb-provider install` | Force re-download binaries, print path(s) |
| `proxyhubb-provider path` | Ensure cached binary exists, print path(s) |
| `proxyhubb-provider …` | Forward args to `provider-cli` |
| `proxyhubb-provider --daemon …` | Forward to `provider-node` |

Env: `PROXYHUBB_API_URL` (default `https://api.proxyhubb.com`), `PROXYHUBB_CLI_VERSION`.

## Rust / cargo

```bash
cargo install --locked --git https://github.com/samuel-1-avson/ProxySocialHub.git --tag provider-v1.0.5 --path services/provider-node
```

Not published to crates.io — use Releases, this pip package, or `cargo install --git`.
