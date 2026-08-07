# proxyhubb-provider

Thin PyPI wrapper that downloads official **provider-cli** / **provider-node** binaries from
`GET /v1/cli/download` and proxies CLI arguments.

```bash
pip install proxyhubb-provider
proxyhubb-provider doctor
# or
pipx run proxyhubb-provider doctor
```

| Command | Behavior |
|---------|----------|
| `proxyhubb-provider install` | Force re-download binary, print path |
| `proxyhubb-provider path` | Ensure cached binary exists, print path |
| `proxyhubb-provider …` | Forward args to `provider-cli` |
| `proxyhubb-provider --daemon …` | Forward to `provider-node` |

Env: `PROXYHUBB_API_URL` (default `https://api.proxyhubb.com`), `PROXYHUBB_CLI_VERSION`.

There is no separate “seller CLI” — sellers are providers. Automate listings with `pip install proxyhubb`.
