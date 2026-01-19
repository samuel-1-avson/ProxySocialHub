import bittensor as bt
import requests
import json
import time

# Configuration
API_URL = "http://control-api:8080/v1/auth" # Internal docker network URL

def test_auth_flow():
    print("1. Generating random wallet...")
    mnemonic = bt.Keypair.generate_mnemonic()
    keypair = bt.Keypair.create_from_mnemonic(mnemonic)
    address = keypair.ss58_address
    print(f"   Address: {address}")

    print("\n2. Requesting Challenge...")
    try:
        resp = requests.post(f"{API_URL}/wallet/challenge", json={"address": address})
        resp.raise_for_status()
        data = resp.json()
        nonce = data['nonce']
        message = data['message']
        print(f"   Nonce: {nonce}")
        print(f"   Message: {message}")
    except Exception as e:
        print(f"   FAILED: {e}")
        return

    print("\n3. Signing Message...")
    # Bittensor/Polkadot signing usually signs the raw bytes or the message string
    # The bridge verify expects the raw message string as 'data'
    signature = keypair.sign(message).hex()
    print(f"   Signature: {signature[:20]}...")

    print("\n4. Logging In...")
    try:
        payload = {
            "address": address,
            "nonce": message, # send the full message as 'nonce' per api/auth.go logic
            "signature": signature
        }
        resp = requests.post(f"{API_URL}/wallet/login", json=payload)
        # print response for debug
        print(f"Status: {resp.status_code}")
        print(f"Body: {resp.text}")
        
        resp.raise_for_status()
        auth_data = resp.json()
        token = auth_data['token']
        print(f"   SUCCESS! Token: {token[:20]}...")
        
        return token
    except Exception as e:
        print(f"   FAILED: {e}")
        return None

if __name__ == "__main__":
    test_auth_flow()
