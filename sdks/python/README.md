# proxyhubb

Official Python client for ProxyHubb Connect (session intents), marketplace credentials, and bulk pools.

## Install

```bash
pip install proxyhubb
```

## Auth

- **API key** (`phub_…`): bulk pools — `X-API-Key`
- **JWT** (dashboard): session intents + order credentials — `Authorization: Bearer`

## Quick start — Connect (rotating / sticky)

```python
from proxyhubb import ProxyHubClient, session_intent_proxy_url
import requests

client = ProxyHubClient(access_token="eyJ...")  # dashboard JWT
intent = client.create_session_intent("rotating", target_geo="US")
proxies = client.as_requests_proxy_from_intent(intent["token"])
print(requests.get("https://httpbin.org/ip", proxies=proxies).json())

# or curl:
# curl -x "http://session-intent:TOKEN@proxy.proxyhubb.com:8090" https://httpbin.org/ip
```

## Marketplace credentials

```python
creds = client.get_order_credentials("ORDER_UUID")
proxies = client.as_requests_proxy_from_credentials(creds)
```

## Bulk pools

```python
client = ProxyHubClient("phub_...")
pool = client.create_pool("scrapers", size=5)
proxies = client.as_requests_proxy(pool["id"])
```

Buyer proxy is HTTP CONNECT / SOCKS5 (`proxy.proxyhubb.com:8090`). See [docs/buyer-proxy.md](../../docs/buyer-proxy.md).

## License

MIT
