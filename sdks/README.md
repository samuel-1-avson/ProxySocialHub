# ProxyHubb buyer SDKs

Official clients for Connect / buyer flows. Default Control API: `https://api.proxyhubb.com`.  
Buyer proxy (HTTP CONNECT / SOCKS5): `proxy.proxyhubb.com:8090` (override with `PROXYHUBB_PROXY_ENDPOINT`).

| Package | Install |
|---------|---------|
| Python | `pip install proxyhubb` |
| Node.js | `npm install @proxyhubb/sdk` |
| Go | `go get github.com/samuel-1-avson/ProxySocialHub/sdks/go@v0.2.0` |

Deprecated: [`sdks/node`](node) — use `@proxyhubb/sdk` instead.

## Auth

| Header | When |
|--------|------|
| `X-API-Key: phub_…` (or `pk_…`) | Bulk pools (`/v1/bulk/pools*`) |
| `Authorization: Bearer <JWT>` | Session intents + order credentials |

Clients accept **api key** and/or **access token**. Use a dashboard JWT (or CLI mint) for Connect session intents; use an API key for bulk pools.

## Shared surface (v0.2)

### Session intent (Connect rotating / sticky)

```
POST /v1/sessions/intent
{ "type": "rotating" | "sticky", "target_geo"?, "listing_id"?, ... }
→ { token, expires_at, lifecycle_state, intent }
```

Proxy smoke:

```text
curl -x "http://session-intent:<token>@proxy.proxyhubb.com:8090" https://httpbin.org/ip
```

SDK methods: `create_session_intent` / `createSessionIntent` / `CreateSessionIntent`  
Helpers: `session_intent_proxy_url(token)` → `http://session-intent:<token>@host:port`

### Order credentials (marketplace)

```
GET /v1/orders/:id/credentials
→ { proxy_credentials: { username, password, host, port, protocol, endpoint } }
```

SDK methods: `get_order_credentials` / `getOrderCredentials` / `GetOrderCredentials`  
Helpers: `proxy_url(user, pass)` / `as_requests_proxy` / Node `proxyUrl` + optional HTTPS agent builder.

### Bulk pools (unchanged)

`create_pool` / `list_pools` / `get_pool` / `get_proxies` / `revoke_pool` → `/v1/bulk/pools*`

## Publish

Tag `sdk-v0.2.0` (or later) to run [`.github/workflows/sdk-publish.yml`](../.github/workflows/sdk-publish.yml) (npm + PyPI).  
Go: push annotated tag on the module path, e.g. `git tag sdks/go/v0.2.0` (see workflow comments / `PUBLISH.md`).
