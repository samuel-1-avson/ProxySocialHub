"""ProxyHub Python SDK client."""

from __future__ import annotations

import requests


class ProxyHubClient:
    """Client for the ProxyHub Bulk Proxy Pool API.

    Parameters
    ----------
    api_key:
        A ProxyHub API key starting with ``phub_``.
    base_url:
        Base URL of the ProxyHub API.  Defaults to the production endpoint.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.proxyhubb.io",
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._session = requests.Session()
        self._session.headers.update({"X-API-Key": self._api_key})

    # ── internal helpers ────────────────────────────────────────────────────

    def _url(self, path: str) -> str:
        return f"{self._base_url}{path}"

    def _get(self, path: str) -> dict:
        resp = self._session.get(self._url(path))
        resp.raise_for_status()
        return resp.json()

    def _post(self, path: str, payload: dict) -> dict:
        resp = self._session.post(self._url(path), json=payload)
        resp.raise_for_status()
        return resp.json()

    def _delete(self, path: str) -> None:
        resp = self._session.delete(self._url(path))
        resp.raise_for_status()

    # ── pool methods ────────────────────────────────────────────────────────

    def create_pool(
        self,
        name: str,
        size: int = 10,
        session_type: str = "rotating",
        description: str = "",
        bytes_limit: int = 0,
    ) -> dict:
        """Create a new proxy pool.

        Parameters
        ----------
        name:
            Human-readable pool name (1-100 characters).
        size:
            Number of proxy endpoints (1-100).  Defaults to 10.
        session_type:
            ``"rotating"`` (each request may use a different IP) or
            ``"sticky"`` (keep the same IP for a session).
        description:
            Optional free-text description.
        bytes_limit:
            Bandwidth cap in bytes.  ``0`` means unlimited.

        Returns
        -------
        dict
            The newly created pool object.
        """
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

    def get_pool(self, pool_id: str) -> dict:
        """Retrieve the endpoints of a proxy pool.

        Parameters
        ----------
        pool_id:
            UUID of the pool.

        Returns
        -------
        dict
            A dict with ``pool_id``, ``endpoints``, and ``count`` keys.
        """
        return self._get(f"/v1/bulk/pools/{pool_id}/endpoints")

    def get_proxies(self, pool_id: str) -> list[dict]:
        """Return the list of endpoint dicts for a pool.

        Parameters
        ----------
        pool_id:
            UUID of the pool.

        Returns
        -------
        list[dict]
            Each item has ``host``, ``port``, ``username``, ``password``,
            and ``session_type`` keys.
        """
        data = self.get_pool(pool_id)
        return data.get("endpoints", [])

    def as_requests_proxy(self, pool_id: str, index: int = 0) -> dict:
        """Return a ``proxies`` dict compatible with the ``requests`` library.

        Parameters
        ----------
        pool_id:
            UUID of the pool.
        index:
            Zero-based index of the endpoint to use from the pool.

        Returns
        -------
        dict
            ``{"http": "http://user:pass@proxy.proxyhubb.io:8888",
               "https": "http://user:pass@proxy.proxyhubb.io:8888"}``
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
