"""Gateway helper for routing HTTP via the ProxyHubb buyer proxy."""

from __future__ import annotations

import time
import uuid
from typing import Any, Optional

import requests

DEFAULT_GATEWAY = "http://proxy.proxyhubb.com:8090"


class ProxyClient:
    """Thin helper that builds ``requests``-compatible proxy URLs for the gateway.

    Prefer :class:`proxyhubb.ProxyHubClient` to create pools and obtain credentials.
    """

    def __init__(
        self,
        gateway_url: str = DEFAULT_GATEWAY,
        proxy_auth: Optional[str] = None,
    ) -> None:
        self.gateway_url = gateway_url
        self.proxy_auth = proxy_auth
        self.current_session_id = str(uuid.uuid4())
        self.session_start = time.time()

    def get_proxy_config(self, rotate: bool = False) -> dict[str, str]:
        if rotate:
            self.current_session_id = str(uuid.uuid4())
            self.session_start = time.time()

        auth_str = self.proxy_auth if self.proxy_auth else "anonymous"
        host = self.gateway_url.split("//")[-1]
        proxy_str = f"http://{auth_str}:{self.current_session_id}@{host}"
        return {"http": proxy_str, "https": proxy_str}

    def request(self, method: str, url: str, rotate: bool = False, **kwargs: Any):
        proxies = self.get_proxy_config(rotate=rotate)
        try:
            return requests.request(method, url, proxies=proxies, **kwargs)
        except Exception:
            return requests.request(
                method, url, proxies=self.get_proxy_config(rotate=True), **kwargs
            )
