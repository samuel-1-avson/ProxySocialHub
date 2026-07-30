# proxyhubb

Official Python client for the ProxyHubb Bulk Proxy Pool API.

## Install

```bash
pip install proxyhubb
```

## Usage

```python
from proxyhubb import ProxyHubClient

client = ProxyHubClient("phub_...")  # default: https://api.proxyhubb.com
pool = client.create_pool("scrapers", size=5)
proxies = client.as_requests_proxy(pool["id"])
```

Create an API key in the dashboard (`phub_…`).

Gateway helper (optional):

```python
from proxyhubb import ProxyClient

gw = ProxyClient(proxy_auth="user:pass")
resp = gw.request("GET", "https://api.ipify.org")
```

## License

MIT
