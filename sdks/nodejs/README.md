# @proxyhubb/sdk

Official Node.js client for the ProxyHubb Bulk Proxy Pool API.

## Install

```bash
npm install @proxyhubb/sdk
```

## Usage

```js
const { ProxyHubClient } = require("@proxyhubb/sdk");

const client = new ProxyHubClient(process.env.PROXYHUBB_API_KEY);
// Default API: https://api.proxyhubb.com

const pool = await client.createPool("scrapers", { size: 5, sessionType: "rotating" });
const endpoints = await client.getProxies(pool.id);
console.log(endpoints[0]); // { host, port, username, password, session_type }
```

Create an API key in the dashboard (`phub_…`), then set:

```bash
export PROXYHUBB_API_KEY=phub_...
```

## API

| Method | Description |
|--------|-------------|
| `createPool(name, options?)` | Create a pool |
| `listPools()` | List your pools |
| `getPool(poolId)` | Pool endpoints payload |
| `getProxies(poolId)` | Endpoint array |
| `revokePool(poolId)` | Soft-delete a pool |

Auth header: `X-API-Key: phub_…` (or `pk_…`).

## License

MIT
