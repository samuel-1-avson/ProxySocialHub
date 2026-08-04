"""Gateway helper for routing HTTP via the ProxyHubb buyer proxy."""

from __future__ import annotations

import time
import uuid
from typing import Any, Optional

import requests

from proxyhubb.client import DEFAULT_PROXY_ENDPOINT, default_proxy_endpoint, proxy_url


class ProxyClient:
    """Thin helper that builds ``requests``-compatible proxy URLs for the gateway.

    Prefer :class:`proxyhubb.ProxyHubClient` for session intents, order credentials,
    and bulk pools.
    """

    def __init__(
        self,
        gateway_url: Optional[str] = None,
        proxy_auth: Optional[str] = None,
    ) -> None:
        endpoint = gateway_url or f"http://{default_proxy_endpoint()}"
        if not endpoint.startswith("http://") and not endpoint.startswith("https://"):
            endpoint = f"http://{endpoint}"
        self.gateway_url = endpoint
        self.proxy_auth = proxy_auth
        self.current_session_id = str(uuid.uuid4())
        self.session_start = time.time()

    def get_proxy_config(self, rotate: bool = False) -> dict[str, str]:
        if rotate:
            self.current_session_id = str(uuid.uuid4())
            self.session_start = time.time()

        host = self.gateway_url.split("//")[-1]
        if self.proxy_auth and ":" in self.proxy_auth:
            user, _, password = self.proxy_auth.partition(":")
            url = proxy_url(user, password, host=host)
        elif self.proxy_auth:
            url = proxy_url(self.proxy_auth, self.current_session_id, host=host)
        else:
            url = proxy_url("anonymous", self.current_session_id, host=host)
        return {"http": url, "https": url}

    def request(self, method: str, url: str, rotate: bool = False, **kwargs: Any):
        proxies = self.get_proxy_config(rotate=rotate)
        try:
            return requests.request(method, url, proxies=proxies, **kwargs)
        except Exception:
            return requests.request(
                method, url, proxies=self.get_proxy_config(rotate=True), **kwargs
            )


__all__ = ["ProxyClient", "DEFAULT_PROXY_ENDPOINT"]
