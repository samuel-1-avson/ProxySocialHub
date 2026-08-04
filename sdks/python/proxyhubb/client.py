"""ProxyHubb Python SDK — Control API client (Connect + bulk pools)."""

from __future__ import annotations

import os
from typing import Any, Mapping, Optional
from urllib.parse import quote

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
    """Client for ProxyHubb Control API (session intents, orders, bulk pools).

    Parameters
    ----------
    api_key:
        ``phub_…`` / ``pk_…`` key for bulk pool endpoints (``X-API-Key``).
    access_token:
        Dashboard JWT for session intents and order credentials (``Authorization: Bearer``).
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
        base_url: str = DEFAULT_BASE_URL,
        proxy_endpoint: Optional[str] = None,
    ) -> None:
        if not api_key and not access_token:
            raise ValueError("api_key or access_token is required")
        self._api_key = api_key or ""
        self._access_token = access_token or ""
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
        """Update Bearer JWT used for session intent / order credential calls."""
        self._access_token = token
        if token:
            self._session.headers["Authorization"] = f"Bearer {token}"
        else:
            self._session.headers.pop("Authorization", None)

    def _url(self, path: str) -> str:
        return f"{self._base_url}{path}"

    def _get(self, path: str) -> dict[str, Any]:
        resp = self._session.get(self._url(path))
        resp.raise_for_status()
        return resp.json()

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        resp = self._session.post(self._url(path), json=payload)
        resp.raise_for_status()
        return resp.json()

    def _delete(self, path: str) -> None:
        resp = self._session.delete(self._url(path))
        resp.raise_for_status()

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
        ``{"proxy_credentials": {username, password, host, port, protocol, endpoint}}``.
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
