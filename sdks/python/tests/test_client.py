from unittest.mock import MagicMock, patch

from proxyhubb import (
    DEFAULT_BASE_URL,
    DEFAULT_PROXY_ENDPOINT,
    ProxyClient,
    ProxyHubClient,
    as_requests_proxies,
    proxy_url,
    session_intent_proxy_url,
)


def test_defaults():
    assert DEFAULT_BASE_URL == "https://api.proxyhubb.com"
    client = ProxyHubClient("phub_test")
    assert client._base_url == "https://api.proxyhubb.com"
    assert client.proxy_endpoint == DEFAULT_PROXY_ENDPOINT


def test_requires_auth():
    try:
        ProxyHubClient()
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_access_token_only():
    client = ProxyHubClient(access_token="jwt_test")
    assert client._session.headers["Authorization"] == "Bearer jwt_test"
    assert "X-API-Key" not in client._session.headers


def test_proxy_url_helpers():
    assert (
        proxy_url("user", "pass", host="proxy.proxyhubb.com:8090")
        == "http://user:pass@proxy.proxyhubb.com:8090"
    )
    assert session_intent_proxy_url("tok").startswith(
        "http://session-intent:tok@proxy.proxyhubb.com:8090"
    )
    assert as_requests_proxies("http://a:b@h:1") == {
        "http": "http://a:b@h:1",
        "https": "http://a:b@h:1",
    }


def test_proxy_client_default_gateway():
    gw = ProxyClient()
    assert "proxy.proxyhubb.com" in gw.gateway_url


def test_create_session_intent_posts():
    client = ProxyHubClient(access_token="jwt")
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "token": "abc",
        "expires_at": "2099-01-01T00:00:00Z",
        "lifecycle_state": "authorized",
        "intent": {"intent_id": "i1", "session_type": "rotating"},
    }
    with patch.object(client._session, "post", return_value=mock_resp) as post:
        out = client.create_session_intent("sticky", target_geo="US")
    assert out["token"] == "abc"
    post.assert_called_once()
    args, kwargs = post.call_args
    assert args[0].endswith("/v1/sessions/intent")
    assert kwargs["json"]["type"] == "sticky"
    assert kwargs["json"]["target_geo"] == "US"


def test_get_order_credentials_gets():
    client = ProxyHubClient(access_token="jwt")
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "proxy_credentials": {
            "username": "u",
            "password": "p",
            "host": "proxy.proxyhubb.com",
            "port": 8090,
            "endpoint": "proxy.proxyhubb.com:8090",
        }
    }
    with patch.object(client._session, "get", return_value=mock_resp) as get:
        out = client.get_order_credentials("order-1")
    assert out["proxy_credentials"]["username"] == "u"
    get.assert_called_once()
    assert get.call_args[0][0].endswith("/v1/orders/order-1/credentials")


def test_as_requests_proxy_from_credentials():
    client = ProxyHubClient("phub_x")
    proxies = client.as_requests_proxy_from_credentials(
        {
            "username": "u",
            "password": "p",
            "host": "proxy.proxyhubb.com",
            "port": 8090,
        }
    )
    assert proxies["https"] == "http://u:p@proxy.proxyhubb.com:8090"


def test_as_requests_proxy_from_intent():
    client = ProxyHubClient(access_token="jwt")
    proxies = client.as_requests_proxy_from_intent("tok")
    assert "session-intent:tok@" in proxies["http"]
