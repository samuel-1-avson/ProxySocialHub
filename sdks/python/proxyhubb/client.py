"""ProxyHubb Python SDK — Bulk Proxy Pool Control API client."""

from __future__ import annotations

from typing import Any

import requests

DEFAULT_BASE_URL = "https://api.proxyhubb.com"


class ProxyHubClient:
    """Client for the ProxyHubb Bulk Proxy Pool API.

    Parameters
    ----------
    api_key:
        A ProxyHubb API key starting with ``phub_`` (or ``pk_``).
    base_url:
        Base URL of the Control API. Defaults to production.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
    ) -> None:
        if not api_key:
            raise ValueError("api_key is required")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._session = requests.Session()
        self._session.headers.update({"X-API-Key": self._api_key})

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
        proxy_url = (
            f"http://{ep['username']}:{ep['password']}@{ep['host']}:{ep['port']}"
        )
        return {"http": proxy_url, "https": proxy_url}
