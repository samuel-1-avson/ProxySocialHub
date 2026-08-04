# Buyer proxy protocols (CONNECT-only HTTP)

ProxyHubb’s buyer-facing edge gateway (`proxy.proxyhubb.com:8090` in production,
`localhost:8090` locally) is an **HTTP CONNECT** (and SOCKS5) proxy — not a
classic absolute-URI forward proxy.

## Supported

| Protocol | Port (default) | Notes |
|----------|----------------|-------|
| **HTTP CONNECT** | `EDGE_GATEWAY_BUYER_PORT` / `8090` | Tunnel TLS and other TCP via `CONNECT host:port`. This is what `curl -x` and browser/system HTTPS proxies use. |
| **SOCKS5** | same buyer listener (when enabled) | Username/password or session-intent auth; supports `target_isp` / geo filters where configured. |

Auth: `Proxy-Authorization` / SOCKS userpass with order credentials or
`session-intent:<token>`.

## Not supported

Plain **HTTP forward-proxy** requests (`GET http://example.com/…` with an
absolute URI, no CONNECT) return **`501 Not Implemented`** with body:

```text
Only CONNECT supported; use HTTP CONNECT or SOCKS5
```

Clients that expect absolute-URI forward proxying (some older scrapers, certain
HTTP libraries without CONNECT) will not work against this endpoint. Use CONNECT
(HTTPS URLs via `curl -x`) or SOCKS5 instead.

## Examples

```bash
# HTTPS via CONNECT (recommended)
curl -x "http://USER:PASS@proxy.proxyhubb.com:8090" https://httpbin.org/ip

# Session intent
curl -x "http://session-intent:TOKEN@proxy.proxyhubb.com:8090" https://httpbin.org/ip
```

Dashboard copy and SDKs should describe the endpoint as **HTTP CONNECT / SOCKS5**,
not “HTTP proxy” in the absolute-URI sense.

## Official SDKs

| Language | Package | Install |
|----------|---------|---------|
| Python | [`proxyhubb`](../sdks/python) | `pip install proxyhubb` |
| Node.js | [`@proxyhubb/sdk`](../sdks/nodejs) | `npm install @proxyhubb/sdk` |
| Go | [`sdks/go`](../sdks/go) | `go get github.com/samuel-1-avson/ProxySocialHub/sdks/go@v0.2.0` |

Shared client surface (session intent, order credentials, bulk pools, proxy URL helpers): [`sdks/README.md`](../sdks/README.md).

Snippet generation API (optional): `GET/POST /v1/sdks/*` on Control API.

## Product note

Implementing a full forward-proxy path remains optional product work (audit
GW-01 / backlog 1.11). Until then, CONNECT-only is the documented contract.
