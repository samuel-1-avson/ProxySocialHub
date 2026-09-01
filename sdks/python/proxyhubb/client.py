"""ProxyHubb Python SDK — Control API client (buyer + seller/provider)."""

from __future__ import annotations

import os
from typing import Any, Mapping, Optional
from urllib.parse import quote, urlencode

import requests

DEFAULT_BASE_URL = "https://api.proxyhubb.com"
DEFAULT_PROXY_ENDPOINT = "proxy.proxyhubb.com:8090"


def default_proxy_endpoint() -> str:
    """Buyer CONNECT host:port (env ``PROXYHUBB_PROXY_ENDPOINT`` overrides)."""
    return (
        os.environ.get("PROXYHUBB_PROXY_ENDPOINT", "").strip()
        or DEFAULT_PROXY_ENDPOINT
    )


def proxy_url(
    username: str,
    password: str,
    *,
    host: Optional[str] = None,
) -> str:
    """Build an HTTP proxy URL for CONNECT clients (curl ``-x``, requests, etc.)."""
    endpoint = (host or default_proxy_endpoint()).removeprefix("http://").removeprefix(
        "https://"
    )
    user = quote(username, safe="")
    pwd = quote(password, safe="")
    return f"http://{user}:{pwd}@{endpoint}"


def session_intent_proxy_url(token: str, *, host: Optional[str] = None) -> str:
    """Proxy URL using session-intent auth (Connect rotating/sticky)."""
    return proxy_url("session-intent", token, host=host)


def as_requests_proxies(proxy: str) -> dict[str, str]:
    """``requests``-compatible ``proxies`` dict from a proxy URL string."""
    return {"http": proxy, "https": proxy}


class ProxyHubClient:
    """Client for ProxyHubb Control API (buyer Connect/bulk + seller/provider).

    Parameters
    ----------
    api_key:
        ``phub_…`` / ``pk_…`` key for bulk pool endpoints (``X-API-Key``).
        Buyer keys do **not** authorize provider/seller routes.
    access_token:
        Dashboard JWT for session intents, order credentials, and seller ops
        (``Authorization: Bearer``).
    provider_token:
        Provider CLI/dashboard token; alias of ``access_token`` (same Bearer header).
    base_url:
        Control API base URL. Defaults to production.
    proxy_endpoint:
        Buyer CONNECT host:port. Defaults to ``PROXYHUBB_PROXY_ENDPOINT`` or production.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        access_token: Optional[str] = None,
        provider_token: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        proxy_endpoint: Optional[str] = None,
    ) -> None:
        bearer = access_token or provider_token or ""
        if not api_key and not bearer:
            raise ValueError("api_key, access_token, or provider_token is required")
        self._api_key = api_key or ""
        self._access_token = bearer
        self._base_url = base_url.rstrip("/")
        self._proxy_endpoint = (
            proxy_endpoint.strip()
            if proxy_endpoint
            else default_proxy_endpoint()
        )
        self._session = requests.Session()
        if self._api_key:
            self._session.headers.update({"X-API-Key": self._api_key})
        if self._access_token:
            self._session.headers.update(
                {"Authorization": f"Bearer {self._access_token}"}
            )

    @property
    def proxy_endpoint(self) -> str:
        return self._proxy_endpoint

    def set_access_token(self, token: str) -> None:
        """Update Bearer JWT / provider token used for authenticated calls."""
        self._access_token = token
        if token:
            self._session.headers["Authorization"] = f"Bearer {token}"
        else:
            self._session.headers.pop("Authorization", None)

    def set_provider_token(self, token: str) -> None:
        """Alias for :meth:`set_access_token` (same Bearer header)."""
        self.set_access_token(token)

    def _url(self, path: str, query: Optional[Mapping[str, Any]] = None) -> str:
        url = f"{self._base_url}{path}"
        if query:
            filtered = {
                k: v for k, v in query.items() if v is not None and v != ""
            }
            if filtered:
                url = f"{url}?{urlencode(filtered)}"
        return url

    def _raise(self, resp: requests.Response) -> None:
        if resp.ok:
            return
        try:
            data = resp.json()
            message = data.get("error") or resp.reason
        except Exception:
            message = resp.reason or resp.text
        raise requests.HTTPError(
            f"ProxyHubb API error {resp.status_code}: {message}",
            response=resp,
        )

    def _get(self, path: str, *, query: Optional[Mapping[str, Any]] = None) -> dict[str, Any]:
        resp = self._session.get(self._url(path, query))
        self._raise(resp)
        return resp.json()

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        resp = self._session.post(self._url(path), json=payload)
        self._raise(resp)
        return resp.json()

    def _put(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        resp = self._session.put(self._url(path), json=payload)
        self._raise(resp)
        return resp.json()

    def _patch(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        resp = self._session.patch(self._url(path), json=payload)
        self._raise(resp)
        return resp.json()

    def _delete(self, path: str) -> dict[str, Any] | None:
        resp = self._session.delete(self._url(path))
        self._raise(resp)
        if resp.status_code == 204 or not resp.content:
            return None
        try:
            return resp.json()
        except Exception:
            return None

    # ── Session intent (Connect) ──────────────────────────────────────────

    def create_session_intent(
        self,
        session_type: str = "rotating",
        *,
        listing_id: Optional[str] = None,
        bandwidth_limit: Optional[int] = None,
        target_geo: Optional[str] = None,
        target_isp: Optional[str] = None,
        routing_profile: Optional[str] = None,
        allowed_domains: Optional[list[str]] = None,
        blocked_domains: Optional[list[str]] = None,
        rotation_type: Optional[str] = None,
        rotation_interval_seconds: Optional[int] = None,
        time_limit_minutes: Optional[int] = None,
        preferred_tier: Optional[str] = None,
        max_price_per_gb: Optional[float] = None,
    ) -> dict[str, Any]:
        """Issue a signed session intent (requires ``access_token``).

        Returns ``token``, ``expires_at``, ``lifecycle_state``, and ``intent``.
        """
        if session_type not in ("rotating", "sticky"):
            raise ValueError("session_type must be 'rotating' or 'sticky'")
        payload: dict[str, Any] = {"type": session_type}
        if listing_id is not None:
            payload["listing_id"] = listing_id
        if bandwidth_limit is not None:
            payload["bandwidth_limit"] = bandwidth_limit
        if target_geo is not None:
            payload["target_geo"] = target_geo
        if target_isp is not None:
            payload["target_isp"] = target_isp
        if routing_profile is not None:
            payload["routing_profile"] = routing_profile
        if allowed_domains is not None:
            payload["allowed_domains"] = allowed_domains
        if blocked_domains is not None:
            payload["blocked_domains"] = blocked_domains
        if rotation_type is not None:
            payload["rotation_type"] = rotation_type
        if rotation_interval_seconds is not None:
            payload["rotation_interval_seconds"] = rotation_interval_seconds
        if time_limit_minutes is not None:
            payload["time_limit_minutes"] = time_limit_minutes
        if preferred_tier is not None:
            payload["preferred_tier"] = preferred_tier
        if max_price_per_gb is not None:
            payload["max_price_per_gb"] = max_price_per_gb
        return self._post("/v1/sessions/intent", payload)

    def as_requests_proxy_from_intent(self, token: str) -> dict[str, str]:
        """``requests`` proxies dict for a session-intent token."""
        return as_requests_proxies(
            session_intent_proxy_url(token, host=self._proxy_endpoint)
        )

    # ── Order credentials (marketplace) ───────────────────────────────────

    def get_order_credentials(self, order_id: str) -> dict[str, Any]:
        """Fetch proxy credentials after escrow activation (requires JWT).

        Returns the API payload, typically
        ``{"proxy_credentials": {username, password, host, port, protocol, endpoint},
        "session_capability": "..."}``.
        Use ``proxy_credentials.password`` (HMAC) for ``proxy.proxyhubb.com:8090``.
        ``session_capability`` is a soak-only ``phubb1.`` token, not that password.
        """
        if not order_id:
            raise ValueError("order_id is required")
        return self._get(f"/v1/orders/{order_id}/credentials")

    def as_requests_proxy_from_credentials(
        self, credentials: Mapping[str, Any]
    ) -> dict[str, str]:
        """Build ``requests`` proxies from a credentials object or envelope."""
        creds = credentials.get("proxy_credentials", credentials)
        username = creds["username"]
        password = creds["password"]
        host = creds.get("host") or creds.get("endpoint") or self._proxy_endpoint
        port = creds.get("port")
        if port and ":" not in str(host):
            host = f"{host}:{port}"
        return as_requests_proxies(proxy_url(username, password, host=str(host)))

    # ── Bulk pools ────────────────────────────────────────────────────────

    def create_pool(
        self,
        name: str,
        size: int = 10,
        session_type: str = "rotating",
        description: str = "",
        bytes_limit: int = 0,
    ) -> dict[str, Any]:
        """Create a new proxy pool."""
        return self._post(
            "/v1/bulk/pools",
            {
                "name": name,
                "size": size,
                "session_type": session_type,
                "description": description,
                "bytes_limit": bytes_limit,
            },
        )

    def list_pools(self) -> dict[str, Any]:
        """List proxy pools for the authenticated account."""
        return self._get("/v1/bulk/pools")

    def get_pool(self, pool_id: str) -> dict[str, Any]:
        """Retrieve the endpoints of a proxy pool."""
        return self._get(f"/v1/bulk/pools/{pool_id}/endpoints")

    def get_proxies(self, pool_id: str) -> list[dict[str, Any]]:
        """Return the list of endpoint dicts for a pool."""
        data = self.get_pool(pool_id)
        return data.get("endpoints", [])

    def revoke_pool(self, pool_id: str) -> None:
        """Soft-delete a proxy pool."""
        self._delete(f"/v1/bulk/pools/{pool_id}")

    def as_requests_proxy(self, pool_id: str, index: int = 0) -> dict[str, str]:
        """Return a ``proxies`` dict compatible with the ``requests`` library.

        Endpoint host/port come from the API (production buyer proxy is
        ``proxy.proxyhubb.com:8090``).
        """
        endpoints = self.get_proxies(pool_id)
        if not endpoints:
            raise ValueError(f"Pool {pool_id!r} has no endpoints")
        if index >= len(endpoints):
            raise IndexError(
                f"index {index} is out of range for pool with {len(endpoints)} endpoints"
            )
        ep = endpoints[index]
        return as_requests_proxies(
            proxy_url(
                ep["username"],
                ep["password"],
                host=f"{ep['host']}:{ep['port']}",
            )
        )

    # ── Provider tokens ───────────────────────────────────────────────────

    def list_provider_tokens(self) -> dict[str, Any]:
        """List provider tokens (masked). Requires JWT or provider token Bearer."""
        return self._get("/v1/provider/tokens")

    def create_provider_token(
        self,
        *,
        name: Optional[str] = None,
        expires_in: Optional[int] = None,
        node_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """Create a provider token. Plaintext ``token`` is returned once."""
        payload: dict[str, Any] = {}
        if name is not None:
            payload["name"] = name
        if expires_in is not None:
            payload["expires_in"] = expires_in
        if node_id is not None:
            payload["node_id"] = node_id
        return self._post("/v1/provider/tokens", payload)

    def rotate_provider_token(self, token_id: str) -> dict[str, Any]:
        """Rotate a provider token; returns new plaintext ``token`` once."""
        if not token_id:
            raise ValueError("token_id is required")
        return self._post(f"/v1/provider/tokens/{token_id}/rotate", {})

    def revoke_provider_token(self, token_id: str) -> dict[str, Any] | None:
        """Revoke a provider token."""
        if not token_id:
            raise ValueError("token_id is required")
        return self._delete(f"/v1/provider/tokens/{token_id}")

    # ── Provider nodes ────────────────────────────────────────────────────

    def get_provider_readiness(self) -> dict[str, Any]:
        return self._get("/v1/provider/readiness")

    def list_provider_nodes(self) -> dict[str, Any]:
        return self._get("/v1/provider/nodes")

    def create_provider_node(
        self,
        name: str,
        *,
        ip_address: Optional[str] = None,
        country: Optional[str] = None,
        city: Optional[str] = None,
        connection_type: Optional[str] = None,
    ) -> dict[str, Any]:
        if not name:
            raise ValueError("name is required")
        payload: dict[str, Any] = {"name": name}
        if ip_address is not None:
            payload["ip_address"] = ip_address
        if country is not None:
            payload["country"] = country
        if city is not None:
            payload["city"] = city
        if connection_type is not None:
            payload["connection_type"] = connection_type
        return self._post("/v1/provider/nodes", payload)

    def update_provider_node(
        self,
        node_id: str,
        *,
        name: Optional[str] = None,
        ip_address: Optional[str] = None,
        country: Optional[str] = None,
        city: Optional[str] = None,
        connection_type: Optional[str] = None,
    ) -> dict[str, Any]:
        if not node_id:
            raise ValueError("node_id is required")
        payload: dict[str, Any] = {}
        if name is not None:
            payload["name"] = name
        if ip_address is not None:
            payload["ip_address"] = ip_address
        if country is not None:
            payload["country"] = country
        if city is not None:
            payload["city"] = city
        if connection_type is not None:
            payload["connection_type"] = connection_type
        return self._put(f"/v1/provider/nodes/{node_id}", payload)

    def delete_provider_node(self, node_id: str) -> dict[str, Any] | None:
        if not node_id:
            raise ValueError("node_id is required")
        return self._delete(f"/v1/provider/nodes/{node_id}")

    def get_node_connect(self, node_id: str) -> dict[str, Any]:
        """Connect hints for provider-cli / provider-node join."""
        if not node_id:
            raise ValueError("node_id is required")
        return self._get(f"/v1/provider/nodes/{node_id}/connect")

    # ── Listings (seller) ─────────────────────────────────────────────────

    def list_my_listings(
        self, *, page: Optional[int] = None, limit: Optional[int] = None
    ) -> dict[str, Any]:
        return self._get("/v1/listings/my", query={"page": page, "limit": limit})

    def get_listing(self, listing_id: str) -> dict[str, Any]:
        if not listing_id:
            raise ValueError("listing_id is required")
        return self._get(f"/v1/listings/{listing_id}")

    def create_listing(self, **fields: Any) -> dict[str, Any]:
        """Create a marketplace listing as seller.

        Required fields typically include ``title``, ``proxy_type``, ``protocol``,
        ``price_per_gb``, ``available_bandwidth_gb``.
        """
        return self._post("/v1/listings", dict(fields))

    def update_listing(self, listing_id: str, **fields: Any) -> dict[str, Any]:
        """Update a listing. Pause/activate with ``status="active"|"paused"``."""
        if not listing_id:
            raise ValueError("listing_id is required")
        return self._patch(f"/v1/listings/{listing_id}", dict(fields))

    def delete_listing(self, listing_id: str) -> dict[str, Any] | None:
        if not listing_id:
            raise ValueError("listing_id is required")
        return self._delete(f"/v1/listings/{listing_id}")

    # ── Earnings ──────────────────────────────────────────────────────────

    def get_earnings_summary(self) -> dict[str, Any]:
        return self._get("/v1/provider/earnings/summary")

    def list_earnings(
        self, *, page: Optional[int] = None, limit: Optional[int] = None
    ) -> dict[str, Any]:
        return self._get(
            "/v1/provider/earnings", query={"page": page, "limit": limit}
        )

    def list_earnings_history(self) -> dict[str, Any]:
        return self._get("/v1/provider/earnings/history")

    # ── DePIN & P2P Direct Mesh (Wave 5+) ──────────────────────────────────

    def create_p2p_signal_offer(
        self,
        session_id: str,
        buyer_pubkey: str,
        provider_hotkey: str,
        offer_sdp: str,
        ice_candidates: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """Register a buyer WebRTC / QUIC direct P2P connection offer."""
        return self._post(
            "/v1/p2p/signal/offer",
            body={
                "session_id": session_id,
                "buyer_pubkey": buyer_pubkey,
                "provider_hotkey": provider_hotkey,
                "offer_sdp": offer_sdp,
                "ice_candidates": ice_candidates or [],
            },
        )

    def create_p2p_signal_answer(
        self,
        session_id: str,
        provider_hotkey: str,
        answer_sdp: str,
        ice_candidates: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """Register a provider WebRTC / QUIC direct P2P connection answer."""
        return self._post(
            "/v1/p2p/signal/answer",
            body={
                "session_id": session_id,
                "provider_hotkey": provider_hotkey,
                "answer_sdp": answer_sdp,
                "ice_candidates": ice_candidates or [],
            },
        )

    def get_p2p_signals(self, session_id: str) -> dict[str, Any]:
        """Get active P2P signaling state for a session."""
        if not session_id:
            raise ValueError("session_id is required")
        return self._get(f"/v1/p2p/signal/{session_id}")

    def get_gateway_operators(self) -> dict[str, Any]:
        """List bonded & manifest-verified Gateway Operators."""
        return self._get("/v1/gateways/operators")

    def get_depin_mining_stats(self) -> dict[str, Any]:
        """Get DePIN network metrics and Proof-of-Bandwidth mining epoch telemetry."""
        return self._get("/v1/network")
