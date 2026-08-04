# Publishing ProxyHubb SDKs

## npm + PyPI (CI)

1. Bump versions in `sdks/nodejs/package.json` and `sdks/python/pyproject.toml` (keep in sync).
2. Merge to the default branch.
3. Tag and push:

```bash
git tag -a sdk-v0.2.0 -m "SDK v0.2.0"
git push origin sdk-v0.2.0
```

This runs [`.github/workflows/sdk-publish.yml`](../.github/workflows/sdk-publish.yml):

- `publish-npm` → `@proxyhubb/sdk` (needs `NPM_TOKEN`)
- `publish-pypi` → `proxyhubb` (needs `PYPI_API_TOKEN`)

Manual: Actions → SDK Publish → `workflow_dispatch` with target `npm` / `pypi` / `both` / `go`.

## Go module tag

Go modules under a subdirectory need a path-scoped tag:

```bash
git tag -a sdks/go/v0.2.0 -m "Go SDK v0.2.0"
git push origin sdks/go/v0.2.0
```

Consumers:

```bash
go get github.com/samuel-1-avson/ProxySocialHub/sdks/go@v0.2.0
```

The `go` workflow_dispatch target runs `go test` only (no registry publish).
