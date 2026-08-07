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


def test_provider_token_alias():
    client = ProxyHubClient(provider_token="ptok")
    assert client._session.headers["Authorization"] == "Bearer ptok"
    client.set_provider_token("ptok2")
    assert client._session.headers["Authorization"] == "Bearer ptok2"


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


def test_create_provider_token():
    client = ProxyHubClient(provider_token="ptok")
    mock_resp = MagicMock()
    mock_resp.ok = True
    mock_resp.status_code = 201
    mock_resp.json.return_value = {"id": "t1", "token": "raw-once"}
    with patch.object(client._session, "post", return_value=mock_resp) as post:
        out = client.create_provider_token(name="edge", node_id="n1")
    assert out["token"] == "raw-once"
    assert post.call_args[0][0].endswith("/v1/provider/tokens")
    assert post.call_args[1]["json"]["node_id"] == "n1"


def test_seller_listing_and_earnings():
    client = ProxyHubClient(access_token="jwt")
    mock_resp = MagicMock()
    mock_resp.ok = True
    mock_resp.status_code = 200
    mock_resp.content = b"{}"
    mock_resp.json.return_value = {"ok": True}

    with patch.object(client._session, "get", return_value=mock_resp) as get:
        client.get_node_connect("n1")
        client.get_earnings_summary()
        client.list_my_listings(page=1, limit=5)
    paths = [c.args[0] for c in get.call_args_list]
    assert paths[0].endswith("/v1/provider/nodes/n1/connect")
    assert paths[1].endswith("/v1/provider/earnings/summary")
    assert "page=1" in paths[2] and "limit=5" in paths[2]

    with patch.object(client._session, "patch", return_value=mock_resp) as patch_call:
        client.update_listing("l1", status="paused")
    assert patch_call.call_args[0][0].endswith("/v1/listings/l1")
    assert patch_call.call_args[1]["json"]["status"] == "paused"
