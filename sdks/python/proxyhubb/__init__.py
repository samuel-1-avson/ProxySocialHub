import requests
import uuid
import time
from typing import Optional, Dict

class ProxyClient:
    """ Official ProxyHubb Python SDK (Phase 7).
    
    Handles AI-native routing, session persistence, and automatic 
    rotation for the ProxyHubb gateway.
    """
    
    def __init__(
        self, 
        gateway_url: str = "http://localhost:8080", 
        proxy_auth: Optional[str] = None
    ):
        self.gateway_url = gateway_url
        self.proxy_auth = proxy_auth
        self.current_session_id = str(uuid.uuid4())
        self.session_start = time.time()
        
    def get_proxy_config(self, rotate: bool = False, host_hint: Optional[str] = None) -> Dict[str, str]:
        """ Generate proxy dictionary for 'requests' library. """
        
        if rotate:
            self.current_session_id = str(uuid.uuid4())
            self.session_start = time.time()
            
        # P2-W7: Inject PHUBB-SESSION and optional PHUBB-HOST-HINT for ML-Router
        auth_str = self.proxy_auth if self.proxy_auth else "anonymous"
        
        # Format: http://user:session@gateway:port
        proxy_str = f"http://{auth_str}:{self.current_session_id}@{self.gateway_url.split('//')[-1]}"
        
        return {
            "http": proxy_str,
            "https": proxy_str
        }

    def request(self, method: str, url: str, rotate: bool = False, **kwargs):
        """ Wrapper around requests.request with automatic rotation support. """
        
        proxies = self.get_proxy_config(rotate=rotate)
        
        # P3-W12: If we want to force ML-routing to a specific domain domain-hint
        # We can pass it in headers or the proxy URL string.
        
        try:
            return requests.request(method, url, proxies=proxies, **kwargs)
        except Exception as e:
            # P7-W20: Implement smart retry logic for 'Sticky Miss' scenarios
            print(f"ProxyHubb SDK Error: {e}. Retrying with new session...")
            return requests.request(method, url, proxies=self.get_proxy_config(rotate=True), **kwargs)

# Example Usage:
# client = ProxyClient(proxy_auth="user123")
# response = client.request("GET", "https://api.ipify.org", rotate=True)
# print(response.text)
