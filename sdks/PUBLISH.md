# Publishing ProxyHubb SDKs

## npm + PyPI — main SDK (`@proxyhubb/sdk` / `proxyhubb`)

1. Bump versions in `sdks/nodejs/package.json` and `sdks/python/pyproject.toml` (keep in sync). Also bump `sdks/python/proxyhubb/__init__.py` `__version__`.
2. Merge to the default branch.
3. Tag and push:

```bash
git tag -a sdk-v0.3.0 -m "SDK v0.3.0"
git push origin sdk-v0.3.0
```

This runs [`.github/workflows/sdk-publish.yml`](../.github/workflows/sdk-publish.yml):

- `publish-npm` → `@proxyhubb/sdk` (needs `NPM_TOKEN`)
- `publish-pypi` → `proxyhubb` (needs `PYPI_API_TOKEN`)

Manual: Actions → SDK Publish → `workflow_dispatch` with target `npm` / `pypi` / `both` / `go`.

## npm + PyPI — provider CLI wrappers

Packages: `@proxyhubb/provider` (`sdks/provider-nodejs`) and `proxyhubb-provider` (`sdks/provider-python`).

1. Bump versions in both package manifests (keep in sync). Also bump `proxyhubb_provider/cli.py` `__version__`.
2. Tag and push:

```bash
git tag -a provider-sdk-v0.1.2 -m "Provider CLI wrappers v0.1.2"
git push origin provider-sdk-v0.1.2
```

Or use workflow_dispatch target `provider` / `provider-npm` / `provider-pypi` on the same SDK Publish workflow.

Install:

```bash
npm install -g @proxyhubb/provider@0.1.2
pip install -U proxyhubb-provider==0.1.2
```

## Cargo (`cargo install`)

`provider-node` is **not** on crates.io (`publish = false`). Install from the release tag:

```bash
cargo install --locked --git https://github.com/samuel-1-avson/ProxySocialHub.git --tag provider-v1.0.5 --path services/provider-node
```

Prefer GitHub Releases / `@proxyhubb/provider` / `proxyhubb-provider` for prebuilt binaries.

## Go module tag

```bash
git tag -a sdks/go/v0.3.0 -m "Go SDK v0.3.0"
git push origin sdks/go/v0.3.0
```

Consumers:

```bash
go get github.com/samuel-1-avson/ProxySocialHub/sdks/go@v0.3.0
```

The `go` workflow_dispatch target runs `go test` only (no registry publish).
