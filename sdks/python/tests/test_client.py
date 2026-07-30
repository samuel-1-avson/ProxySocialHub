from proxyhubb import ProxyHubClient, ProxyClient, DEFAULT_BASE_URL


def test_defaults():
    assert DEFAULT_BASE_URL == "https://api.proxyhubb.com"
    client = ProxyHubClient("phub_test")
    assert client._base_url == "https://api.proxyhubb.com"


def test_requires_api_key():
    try:
        ProxyHubClient("")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_proxy_client_default_gateway():
    gw = ProxyClient()
    assert "proxy.proxyhubb.com" in gw.gateway_url
