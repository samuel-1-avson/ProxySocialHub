# Provider node operations

Production binary: **`provider-node`** (Rust). Optional dev helper: **`proxyhubb-cli`**.

## Quick reference

| Task | Command |
|------|---------|
| Register API key | `provider-node register --api-key <token> --config provider.toml` |
| Offline config validation | `provider-node config validate --config provider.toml` or `provider-node config validate --json` |
| Start daemon | `provider-node start --config provider.toml` |
| Local metrics | `provider-node metrics` (default `http://localhost:9090/stats`) |
| Stop daemon | `provider-node stop` |
| Operator status | `provider-node status` or `provider-node status --json` |
| Live pre-flight checks | `provider-node doctor` or `provider-node doctor --json` |
| Live terminal UI | `provider-node dashboard` (q quit, r refresh) |
| Watch mode | `provider-node watch` (Ctrl+C to exit) |
| Service install | `provider-node service install --config provider.toml` |
| Service status | `provider-node service status --json` |
| Support bundle | `provider-node support bundle --config provider.toml` |
| Install hints | `provider-node install` |
| Wrapper CLI | `proxyhubb-cli` — same commands via delegation (`join`, `doctor`, `dashboard`, …) |

Canonical paths (also `proxyhubb-cli paths`):

- Config: `~/.config/proxyhubb/provider.toml` on Linux/macOS; `%APPDATA%\proxyhubb\provider.toml` on Windows (same as `dirs::config_dir`)
- State: `~/.proxyhubb/` — PID, `runtime.json`, `logs/provider-node.log`
- Legacy config `~/.proxyhubb/provider.toml` is still read if present; `scripts/bootstrap-provider-dev.ps1` migrates it on first run.

Dev bootstrap:

```powershell
.\scripts\bootstrap-provider-dev.ps1 -StartNode
```

Config example: `config/docker/provider.toml.example` (`metrics_port = 9090`).

### Docker provider overlay (local)

```powershell
# TLS material for tunnel (once)
.\scripts\generate-local-edge-certs.ps1

# Transport must match on edge + provider (default yamux via root .env PROVIDER_TRANSPORT)
docker compose -f docker-compose.yml -f docker-compose.provider.yml --profile provider up -d --build

# Honest readiness (fails until gateway heartbeat succeeds)
docker exec proxyhubb-provider-node wget -qO- http://127.0.0.1:9090/health/ready
docker exec proxyhubb-provider-node wget -qO- http://127.0.0.1:9090/stats
```

Do **not** set edge to `quic` while the provider uses `yamux` (or the reverse). For QUIC, set `PROVIDER_TRANSPORT=quic` for both services, keep `./certs` present, rebuild with QUIC features.

### CLI distribution (seller downloads)

```powershell
# Index binaries under cli-dist/<CLI_DIST_VERSION>/ into control-api
.\scripts\seed-cli-dist-linux-from-docker.ps1   # export linux daemon from provider image
# optional: .\rebuild-cli.ps1                   # windows host rebuild
docker compose -f docker-compose.yml up -d --force-recreate control-api

# Public smoke test
.\scripts\verify-cli-download.ps1 -Platform windows -Arch amd64 -PackageType daemon
.\scripts\verify-cli-download.ps1 -Platform linux -Arch amd64 -PackageType daemon

# Catalog + download (no auth)
# GET /v1/cli/downloads
# GET /v1/cli/download?platform=linux&arch=amd64&package_type=daemon
```

Dashboard: **Provider → CLI** (`/dashboard/provider/cli`).

### Multi-provider (local Docker)

```powershell
# Instance 1 (default)
.\scripts\bootstrap-provider-docker.ps1 -ForceNewToken

# Instance 2 (separate token + node)
.\scripts\bootstrap-provider-docker.ps1 -Instance 2 -ForceNewToken -SkipSyncSigningKeyToControlApi

docker compose -f docker-compose.yml -f docker-compose.provider.yml `
  --profile provider --profile multi-provider up -d
```

### Home / remote provider (not Docker)

```powershell
# Local API + host binary
.\scripts\bootstrap-home-provider.ps1 -StartProvider

# Remote testnet (bring your own API key from dashboard)
.\scripts\bootstrap-home-provider.ps1 `
  -ControlApiUrl https://api.testnet.example.com `
  -GatewayAddr proxy.testnet.example.com:3128 `
  -ApiKey <provider_token> `
  -StartProvider
```

### Secret hygiene (shared testnet)

- Never commit `config/docker/provider*.compose.env`, `config/docker/provider*.toml`, or `certs/*.key`.
- Rotate provider API tokens and signing keys before inviting external sellers.
- Disable `PROXYHUB_ALLOW_DEV_*` and set production-like `APP_ENV` on public hosts (see production readiness verdict).

Validate before starting:

```text
provider-node config validate --config provider.toml
provider-node doctor --config provider.toml
```

`config validate` is offline and checks TOML, credentials presence, gateway syntax, signing key, TLS paths, ports, and runtime limits. `doctor` adds live Control API, auth, per-gateway DNS/reachability/TLS checks, daemon, and metrics checks.

## Stop behavior

### Linux / macOS

`provider-node stop` reads `~/.proxyhubb/provider.pid` and sends **SIGTERM** to the process.

### Windows

`provider-node stop` reads `%USERPROFILE%\.proxyhubb\provider.pid` and runs:

```text
taskkill /PID <pid> /F
```

If stop fails (permissions, stale PID), end the process in Task Manager or:

```powershell
Get-Content $env:USERPROFILE\.proxyhubb\provider.pid
Stop-Process -Id <pid> -Force
Remove-Item $env:USERPROFILE\.proxyhubb\provider.pid -ErrorAction SilentlyContinue
```

## OS-specific downloads

The CLI distribution API stores OS-specific packages by platform, architecture, and package type:

| Package type | Purpose |
|--------------|---------|
| `daemon` | `provider-node` binary only |
| `wrapper` | `proxyhubb-cli` onboarding wrapper |
| `bundle` | OS package with provider-node, wrapper scripts, docs, and service helpers |

Recommended bundles:

- Windows amd64: `provider-bundle-<version>-windows-amd64.zip`
- Linux amd64/arm64: `provider-bundle-<version>-linux-amd64.tar.gz` or `provider-bundle-<version>-linux-arm64.tar.gz`
- macOS amd64/arm64: `provider-bundle-<version>-macos-amd64.tar.gz` or `provider-bundle-<version>-macos-arm64.tar.gz`

The dashboard download page prefers `bundle` when available and falls back to the daemon binary.

## Service management

`provider-node service` manages the daemon as a background process with the same config file used by manual startup:

```text
provider-node service install --config provider.toml
provider-node service start
provider-node service status
provider-node service stop
provider-node service uninstall
```

Linux uses a user-level systemd unit. macOS uses a LaunchAgent. Windows registers a service with `sc.exe`; run the terminal as Administrator when installing/uninstalling.

## Token rotation

Provider API tokens can expire. The dashboard token page flags expired and soon-to-expire tokens and exposes **Rotate**.

Rotation creates a fresh token and revokes the old token. After rotating:

1. Copy the new token from the one-time banner.
2. Replace `api_key = "<old>"` in `provider.toml`.
3. Run `provider-node config validate --config provider.toml`.
4. Restart the service or daemon.

## Support bundle

For operator support, export one redacted JSON file:

```text
provider-node support bundle --config provider.toml
```

The bundle includes redacted config, `doctor --json` output, the last provider log lines, and runtime state including the current provider run ID and active gateway. It never includes raw `api_key`, `jwt_token`, or `provider_signing_key`.

## Running as a Windows service (legacy/manual)

When not using `provider-node service`, always-on Windows hosts can still register manually:

1. Build or download `provider-node.exe`.
2. Place `provider.toml` in a fixed path (e.g. `C:\ProxyHubb\provider.toml`).
3. Register a service with **NSSM** or **sc.exe** that runs:

   ```text
   C:\ProxyHubb\provider-node.exe start --config C:\ProxyHubb\provider.toml
   ```

4. Ensure `metrics_port` does not conflict with other apps.
5. On upgrade, `provider-node stop` then replace the binary and restart the service.

Document firewall rules for outbound HTTPS to control-api and gateway ports.

## Proof mode (staging → production)

| Variable | Values | Notes |
|----------|--------|-------|
| `PROVIDER_SIGNATURE_MODE` | `observe` (default), `enforce` | Listing offers + heartbeat proofs |
| `PROXYHUB_REQUIRE_SIGNED_HEARTBEATS` | `true` / `false` | Gateway admission |

**Staging enforce:** see [STAGING_ENFORCE_RUNBOOK.md](./STAGING_ENFORCE_RUNBOOK.md) and [PROVIDER_PROOFS_DOCKER.md](./PROVIDER_PROOFS_DOCKER.md).

**Docker local default** remains `observe` in root `docker-compose.yml`; set `PROVIDER_SIGNATURE_MODE=enforce` in `.env` before running soak scripts.

**Production:** `docker-compose.prod.yml` defaults to `PROVIDER_SIGNATURE_MODE=enforce` and `PROXYHUB_REQUIRE_SIGNED_HEARTBEATS=true`. With `APP_ENV=production` and no explicit mode, control-api also defaults to enforce.

## CI

- Go contract test: `TestProviderNodeAPIContract` (gateway-token → nodes → lease → heartbeat).
- Rust unit tests: `cargo test` in `services/provider-node` (GitHub job `provider-node-check`).
- Full stack: `./scripts/provider-docker-e2e.sh` (GitHub job `provider-docker-e2e`).
