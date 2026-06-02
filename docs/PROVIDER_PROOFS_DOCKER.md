# Provider proofs on Docker

End-to-end signed provider heartbeats in the main `docker-compose.yml` stack.

## Prerequisites

- Main stack running: `docker compose up -d`
- `.env` with `POSTGRES_PASSWORD`, `TOKEN_HMAC_SECRET`, and other required secrets

## 1. Bootstrap credentials

```powershell
.\scripts\bootstrap-provider-docker.ps1
```

If bootstrap fails with `ConvertFrom-Json` / empty JSON, pull latest code (bootstrap uses `-output-json` to avoid Go log noise on stdout) and retry:

```powershell
.\scripts\bootstrap-provider-docker.ps1 -ForceNewToken
```

If a node exists but `hotkey` does not match the signing key (heartbeats stay unsigned), resync after bootstrap:

```powershell
.\scripts\bootstrap-provider-docker.ps1 -ResyncHotkey
```

This writes `config/docker/provider.compose.env` (gitignored) with:

- `PROXYHUB_API_KEY` — dev provider token (HMAC, same as control-api)
- `PROXYHUB_PROVIDER_SIGNING_KEY` — base58 Ed25519 seed for heartbeat proofs

It also syncs `provider_nodes.hotkey` to the signing public key when a node row exists.

## 2. Start the provider container

```powershell
.\scripts\bootstrap-provider-docker.ps1 -StartProvider
# or rebuild image:
.\scripts\bootstrap-provider-docker.ps1 -Build -StartProvider
```

Equivalent manual command:

```powershell
docker compose -f docker-compose.yml -f docker-compose.provider.yml --profile provider up -d provider-node
```

The provider connects to `edge-gateway:3128` and `control-api:8080` on the Docker network.

## 3. Verify

Wait about two minutes for the first signed heartbeat, then:

```powershell
.\scripts\verify-provider-proofs-docker.ps1
# or wait inline:
.\scripts\verify-provider-proofs-docker.ps1 -WaitSeconds 130
```

Success means `latest_heartbeat_verified = true` in Postgres for the active node.

## Environment reference

| Variable | Service | Default | Meaning |
|----------|---------|---------|---------|
| `PROVIDER_SIGNATURE_MODE` | control-api | `observe` | `observe` or `enforce` |
| `PROXYHUB_REQUIRE_SIGNED_HEARTBEATS` | edge-gateway | `false` | Reject unsigned tunnel heartbeats |
| `PROXYHUB_PROVIDER_SIGNING_KEY` | provider-node | (bootstrap) | Base58 Ed25519 signing seed |
| `PROXYHUB_API_KEY` | provider-node | (bootstrap) | Provider API token |

## Enforcement rollout

1. Run in `observe` until most nodes send valid proofs.
2. Set `PROVIDER_SIGNATURE_MODE=enforce` on control-api and recreate the container.
3. Optionally set `PROXYHUB_REQUIRE_SIGNED_HEARTBEATS=true` on edge-gateway.

## Host-run alternative

For a provider on the host (not Docker):

```powershell
.\scripts\bootstrap-provider-dev.ps1 -StartNode
```

Use `gateway_addr = "localhost:3128"` in `provider.toml` and add `provider_signing_key` (or `PROXYHUB_PROVIDER_SIGNING_KEY`).
