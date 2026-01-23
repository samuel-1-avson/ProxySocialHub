import requests
import json
import base64

def test_proxy_flow():
    base_url = "http://localhost:8081/v1"
    
    # 1. Login
    print("Logging in as dev user...")
    res = requests.post(f"{base_url}/auth/dev/login")
    if res.status_code != 200:
        print(f"Login failed: {res.status_code} - {res.text}")
        return
    
    data = res.json()
    token = data["token"]
    user_id = data["user"]["id"]
    print(f"Logged in as user {user_id}")
    
    # 2. Create Session
    print("\nCreating session...")
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    payload = {
        "type": "rotating",
        "bandwidth_limit": 1024 * 1024 * 1024 # 1GB
    }
    res = requests.post(f"{base_url}/sessions", headers=headers, json=payload)
    if res.status_code != 201:
        print(f"Session creation failed: {res.status_code} - {res.text}")
        return
    
    session_data = res.json()
    credentials = session_data["proxy_credentials"]
    print(f"Session created: {session_data['session']['id']}")
    print(f"Credentials: {credentials}")
    
    # 3. Verify Proxy Auth (via Edge Gateway)
    proxy_url = "http://localhost:8443" # Edge Gateway port
    username = credentials["username"]
    password = credentials["password"]
    
    auth_str = f"{username}:{password}"
    auth_b64 = base64.b64encode(auth_str.encode()).decode()
    
    # We use CONNECT to test the proxy
    print(f"\nTesting proxy auth with username: {username}")
    
    # Use a real site to test connectivity (but gateway might block if not verified)
    # The gateway code has a policy validate_destination.
    try:
        # Note: requests doesn't support CONNECT easily for arbitrary ports, 
        # but we can use as a proxy for a simple HTTP request.
        proxies = {
            "http": f"http://{username}:{password}@localhost:3128",
            "https": f"http://{username}:{password}@localhost:3128",
        }
        
        # Test 1: Check metadata via Edge Gateway internal logs (we'll check docker logs later)
        # For now just try a request
        print("Sending request through proxy...")
        res = requests.get("http://example.com", proxies=proxies, timeout=10)
        print(f"Proxy request status: {res.status_code}")
    except Exception as e:
        print(f"Proxy request failed (expected if no providers online): {e}")

if __name__ == "__main__":
    test_proxy_flow()
