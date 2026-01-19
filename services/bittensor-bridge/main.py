import bittensor as bt
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
import os

app = FastAPI(title="Bittensor Bridge")

# Configuration
# Default to the local subtensor service defined in docker-compose
SUBTENSOR_NETWORK = os.getenv("SUBTENSOR_NETWORK", "local")
SUBTENSOR_CHAIN_ENDPOINT = os.getenv("SUBTENSOR_CHAIN_ENDPOINT", "ws://subtensor:9944")

def get_subtensor():
    try:
        # Connecting to the local node
        config = bt.config()
        config.subtensor.network = SUBTENSOR_NETWORK
        config.subtensor.chain_endpoint = SUBTENSOR_CHAIN_ENDPOINT
        sub = bt.subtensor(config=config)
        return sub
    except Exception as e:
        print(f"Error connecting to subtensor: {e}")
        raise HTTPException(status_code=503, detail=f"Failed to connect to Subtensor: {str(e)}")

@app.get("/")
def health_check():
    return {"status": "ok", "service": "bittensor-bridge"}

@app.get("/network/status")
def get_network_status():
    """
    Returns basic status information from the connected Subtensor node.
    """
    sub = get_subtensor()
    current_block = sub.get_current_block()
    return {
        "network": sub.network,
        "chain_endpoint": sub.chain_endpoint,
        "current_block": current_block,
        "is_connected": sub.is_connected()
    }

class ProxyRegistrationRequest(BaseModel):
    ip: str
    port: int
    net_uid: int
    wallet_name: str = "default"
    wallet_hotkey: str = "default"

@app.post("/proxy/register")
def register_proxy_on_chain(req: ProxyRegistrationRequest):
    try:
        # Load Wallet
        wallet = bt.wallet(name=req.wallet_name, hotkey=req.wallet_hotkey)
        if not wallet.hotkey_file.exists_on_device():
             return {"status": "error", "message": "Wallet not found", "data": {}}

        # Connect to Subtensor
        sub = bt.subtensor(network=SUBTENSOR_NETWORK, chain_endpoint=SUBTENSOR_CHAIN_ENDPOINT)
        
        # Check if already registered (mock check or real check)
        # For simplicity in dev, we just attempt serve_axon which is the standard "Announce IP"
        # In a real subnet, strictly speaking we might use a custom extrinsic.
        # But `serve` is the generic "I am here" signal.
        
        success = sub.serve_axon(
            netuid=req.net_uid,
            axon=bt.axon(wallet=wallet, port=req.port, ip=req.ip),
            wait_for_inclusion=True,
            wait_for_finalization=False
        )
        
        if success:
            return {"status": "success", "message": "Proxy registered on-chain", "data": {"tx_hash": "0x..."}}
        else:
             return {"status": "error", "message": "Failed to serve axon", "data": {}}

    except Exception as e:
        print(f"Registration Error: {e}")
        return {"status": "error", "message": str(e), "data": {}}

# ==========================================
# Wallet Management
# ==========================================

class WalletInfo(BaseModel):
    name: str = "default"
    hotkey: str = "default"

@app.post("/wallet/create-dev")
def create_dev_wallet(info: WalletInfo):
    """
    Creates a wallet for development/testing (no password).
    WARNING: Do not use for production funds without security hardening.
    """
    try:
        wallet = bt.wallet(name=info.name, hotkey=info.hotkey)
        wallet.create_if_non_existent(coldkey_use_password=False, hotkey_use_password=False)
        return {
            "status": "created",
            "coldkey_ss58": wallet.coldkeypub.ss58_address,
            "hotkey_ss58": wallet.hotkey.ss58_address,
            "path": str(wallet.path)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/wallet")
def get_wallet(name: str = "default", hotkey: str = "default"):
    try:
        wallet = bt.wallet(name=name, hotkey=hotkey)
        if not wallet.hotkey_file.exists_on_device() or not wallet.coldkeypub_file.exists_on_device():
             raise HTTPException(status_code=404, detail="Wallet not found")
        
        # In a real app, we need to connect to subtensor to get balance
        # For offline, we can just return addresses
        
        balance = "0.0"
        try:
            sub = bt.subtensor(network=SUBTENSOR_NETWORK, chain_endpoint=SUBTENSOR_CHAIN_ENDPOINT)
            balance_obj = sub.get_balance(wallet.coldkeypub.ss58_address)
            balance = str(balance_obj.tao)
        except:
            pass # Ignore connection errors for balance check if offline

        return {
            "coldkey_ss58": wallet.coldkeypub.ss58_address,
            "hotkey_ss58": wallet.hotkey.ss58_address,
            "balance": balance
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class TransferRequest(BaseModel):
    wallet_name: str
    wallet_hotkey: str = "default"
    destination: str # SS58 address
    amount: float # TAO amount

@app.post("/wallet/transfer")
def transfer_tao(req: TransferRequest):
    try:
        wallet = bt.wallet(name=req.wallet_name, hotkey=req.wallet_hotkey)
        sub = bt.subtensor(network=SUBTENSOR_NETWORK, chain_endpoint=SUBTENSOR_CHAIN_ENDPOINT)
        
        success = sub.transfer(
            wallet=wallet,
            dest=req.destination,
            amount=req.amount,
            wait_for_inclusion=True,
            wait_for_finalization=False
        )
        
        if success:
             return {"status": "success", "message": "Transfer successful"}
        else:
             return {"status": "error", "message": "Transfer failed"}
    except Exception as e:
         return {"status": "error", "message": str(e)}

# ==========================================
# Validator / Compute Logic (Phase 4)
# ==========================================

class Validator:
    def __init__(self):
        self.scores = {} # Map netuid -> { hotkey -> score }
        self.lock = threading.Lock()
        self.running = True

    def run_validation_loop(self):
        print("Validator: Starting validation loop...")
        while self.running:
            try:
                # In a real subnet, we would:
                # 1. Query metagraph for all registered uids
                # 2. Select a batch to validate
                # 3. Connect to their Axon (IP:Port)
                # 4. Measure latency, success rate, bandwidth
                # 5. Set weights on-chain
                
                # Mock Validation:
                # We just generate random scores for "default" hotkey (our test one)
                # and maybe some others.
                
                with self.lock:
                    # Mock defaults
                    self.scores[1] = {
                        "default": random.uniform(0.8, 1.0), # Good node
                        "5F...bad": random.uniform(0.0, 0.2) # Bad node
                    }
                
                print(f"Validator: Updated scores: {self.scores}")
                time.sleep(30) # Validate every 30s
            except Exception as e:
                print(f"Validator Error: {e}")
                time.sleep(5)

    def get_score(self, netuid: int, hotkey: str) -> float:
        with self.lock:
            if netuid in self.scores:
                return self.scores[netuid].get(hotkey, 0.0)
        return 0.0

validator = Validator()
# Start background thread
t = threading.Thread(target=validator.run_validation_loop, daemon=True)
t.start()

@app.get("/validators/scores")
def get_validator_scores(netuid: int = 1):
    with validator.lock:
        return {
            "netuid": netuid,
            "scores": validator.scores.get(netuid, {})
        }

@app.get("/transaction/{hash}")
def get_transaction(hash: str):
    """
    Get transaction details to verify deposits.
    Note: Bittensor SDK doesn't have a direct 'get_transaction' easy helper,
    usually requires querying the block. 
    For MVP, we might skip implementation or assume success if we see it in block.
    """
    # Mocking for now as deep chain query requires traversing blocks
    return {"status": "unknown", "message": "Transaction indexing not implemented in bridge yet."}


class VerifySignatureRequest(BaseModel):
    ss58_address: str
    data: str # The message that was signed
    signature: str # The hex-encoded signature

@app.post("/auth/verify")
def verify_signature(req: VerifySignatureRequest):
    """
    Verifies a signature using Bittensor/Substrate logic.
    Supports sr25519 (default for Polkadot/Bittensor).
    """
    try:
        # Create a Keypair from the public address
        keypair = bt.Keypair(ss58_address=req.ss58_address)
        
        # Verify
        # PolkadotJS usually sends a hex string for the signature
        # data usually comes as is.
        is_valid = keypair.verify(req.data, req.signature)
        
        return {"is_valid": is_valid}
    except Exception as e:
        print(f"Verification error: {e}")
        return {"is_valid": False, "error": str(e)}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
