# @proxyhubb/sdk

Official Node.js client for ProxyHubb Connect (session intents), marketplace credentials, and bulk pools.

## Install

```bash
npm install @proxyhubb/sdk
```

Optional HTTPS agent helper:

```bash
npm install https-proxy-agent
```

## Auth

- **API key** (`phub_…`): bulk pools — `X-API-Key`
- **JWT** (dashboard): session intents + order credentials — `Authorization: Bearer`

## Quick start — Connect

```js
const { ProxyHubClient, sessionIntentProxyUrl } = require("@proxyhubb/sdk");

const client = new ProxyHubClient({ accessToken: process.env.PROXYHUBB_JWT });
const intent = await client.createSessionIntent("rotating", { targetGeo: "US" });
const proxy = client.sessionIntentProxyUrl(intent.token);
// curl -x "http://session-intent:TOKEN@proxy.proxyhubb.com:8090" https://httpbin.org/ip
```

With `https-proxy-agent`:

```js
const agent = client.createHttpsProxyAgent(proxy);
// pass agent to fetch/undici or axios httpsAgent
```

## Marketplace credentials

```js
const { proxy_credentials } = await client.getOrderCredentials("ORDER_UUID");
const url = client.proxyUrlFromCredentials(proxy_credentials);
```

## Bulk pools

```js
const client = new ProxyHubClient(process.env.PROXYHUBB_API_KEY);
const pool = await client.createPool("scrapers", { size: 5, sessionType: "rotating" });
const url = await client.proxyUrlForPool(pool.id);
```

## API

| Method | Description |
|--------|-------------|
| `createSessionIntent(type, options?)` | Issue Connect intent (JWT) |
| `sessionIntentProxyUrl(token)` | CONNECT proxy URL |
| `getOrderCredentials(orderId)` | Marketplace credentials (JWT) |
| `proxyUrlFromCredentials(creds)` | CONNECT proxy URL |
| `createHttpsProxyAgent(url)` | Optional agent helper |
| `createPool` / `listPools` / `getPool` / `getProxies` / `revokePool` | Bulk pools |
| `proxyUrlForPool(poolId, index?)` | Pool endpoint URL |

Buyer proxy: HTTP CONNECT / SOCKS5 — see [docs/buyer-proxy.md](../../docs/buyer-proxy.md).

## License

MIT
