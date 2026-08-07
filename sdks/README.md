# ProxyHubb SDKs (buyer + seller/provider)

Official clients for Connect / buyer flows **and** seller/provider automation.  
Default Control API: `https://api.proxyhubb.com`.  
Buyer proxy (HTTP CONNECT / SOCKS5): `proxy.proxyhubb.com:8090` (override with `PROXYHUBB_PROXY_ENDPOINT`).

| Package | Install |
|---------|---------|
| Python | `pip install proxyhubb` |
| Node.js | `npm install @proxyhubb/sdk` |
| Go | `go get github.com/samuel-1-avson/ProxySocialHub/sdks/go@v0.3.0` |
| Provider CLI (npm) | `npm install -g @proxyhubb/provider` → `proxyhubb-provider` |
| Provider CLI (PyPI) | `pip install proxyhubb-provider` → `proxyhubb-provider` |

There is **no separate “seller CLI”** — sellers are providers. Use Provider CLI / `@proxyhubb/provider` for the node, and SDK seller methods for listings/tokens/nodes/earnings.

Deprecated: [`sdks/node`](node) — use `@proxyhubb/sdk` instead.

## Auth

| Credential | Header | Use for |
|------------|--------|---------|
| Buyer API key `phub_…` / `pk_…` | `X-API-Key` | Bulk pools only |
| Dashboard JWT | `Authorization: Bearer` | Connect intents, order credentials, **seller/provider APIs** |
| Provider token | `Authorization: Bearer` | Same as JWT for provider routes (nodes, tokens, earnings, listings) |

Buyer API keys **do not** authorize provider/seller routes. Pass `accessToken` / `providerToken` (Node), `access_token` / `provider_token` (Python), or `NewClientWithToken` / `NewClientWithProviderToken` (Go).

## Shared surface (v0.3)

### Buyer — session intent

```
POST /v1/sessions/intent
→ { token, expires_at, lifecycle_state, intent }
```

### Buyer — order credentials / bulk pools

Unchanged from v0.2.

### Seller / provider

| Area | Methods |
|------|---------|
| Tokens | `listProviderTokens`, `createProviderToken` (plaintext once), `rotateProviderToken`, `revokeProviderToken` |
| Nodes | `listProviderNodes`, `createProviderNode`, `updateProviderNode`, `deleteProviderNode`, `getNodeConnect`, `getProviderReadiness` |
| Listings | `listMyListings`, `createListing`, `updateListing` (`status: active\|paused`), `deleteListing`, `getListing` |
| Earnings | `getEarningsSummary`, `listEarnings`, `listEarningsHistory` |

**Not in SDKs:** heartbeat, gateway-token, offer signing, private signing keys (daemon-only).

## Publish

Tag `sdk-v0.3.0` (or later) to run [`.github/workflows/sdk-publish.yml`](../.github/workflows/sdk-publish.yml) (npm + PyPI).  
Provider wrappers: tag `provider-sdk-v*` (see `PUBLISH.md`).  
Go: `git tag sdks/go/v0.3.0` (see `PUBLISH.md`).
