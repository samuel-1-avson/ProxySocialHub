import hashlib
import json
import time
from typing import Dict, Any
from nacl.signing import SigningKey
from nacl.encoding import HexEncoder

# Install: pip install pynacl

class AgentSigner:
    def __init__(self, private_key_hex: str):
        self.signing_key = SigningKey(private_key_hex, encoder=HexEncoder)
        self.verify_key = self.signing_key.verify_key
    
    def get_public_key(self) -> str:
        return self.verify_key.encode(encoder=HexEncoder).decode('utf-8')
    
    def sign_output(self, content_str: str, metadata: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Signs a piece of content (string) and returns the full payload expected by ProxyHubb Registry.
        """
        # 1. Hash the content (SHA256)
        content_hash_bytes = hashlib.sha256(content_str.encode('utf-8')).digest()
        content_hash_hex = content_hash_bytes.hex()
        
        # 2. Sign the HASH (not raw content, for efficiency)
        signed = self.signing_key.sign(bytes.fromhex(content_hash_hex))
        signature_hex =  signed.signature.hex()
        
        return {
            "content_hash": content_hash_hex,
            "signature": signature_hex,
            "metadata": metadata or {"timestamp": int(time.time()), "agent_version": "1.0.0"}
        }

if __name__ == "__main__":
    # Example Usage
    
    # 1. Generate a generic key (In reality, load from env)
    new_key = SigningKey.generate()
    private_key_hex = new_key.encode(encoder=HexEncoder).decode('utf-8')
    print(f"Agent Private Key: {private_key_hex}")
    
    agent = AgentSigner(private_key_hex)
    print(f"Agent Validate Public Key: {agent.get_public_key()}")
    
    # 2. Sign Work
    output_text = "Market Analysis: $TAO is trending upwards due to increased demand in decentralized AI Compute."
    payload = agent.sign_output(output_text, metadata={"model": "gpt-4o", "confidence": 0.98})
    
    print("\n--- Payload for POST /registry/agents/verify/output ---")
    print(json.dumps({
        "agent_id": "[YOUR_AGENT_UUID]",
        **payload
    }, indent=2))
