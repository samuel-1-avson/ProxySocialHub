import bittensor as bt
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
import os
import threading
import time
import random
import requests

app = FastAPI(title="Bittensor Bridge")

# Configuration
# Default to the local subtensor service defined in docker-compose
SUBTENSOR_NETWORK = os.getenv("SUBTENSOR_NETWORK", "local")
SUBTENSOR_CHAIN_ENDPOINT = os.getenv("SUBTENSOR_CHAIN_ENDPOINT", "ws://subtensor:9944")

def get_subtensor():
    try:
        # Connecting to the local node
        # SDK Compatibility: chain_endpoint might be deprecated for constructor in favor of config
        config = bt.config()
        config.subtensor.network = SUBTENSOR_NETWORK
        config.subtensor.chain_endpoint = SUBTENSOR_CHAIN_ENDPOINT
        # Use config to initialize which is more stable across versions
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
        sub = get_subtensor()
        
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
            sub = get_subtensor()
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
        sub = get_subtensor()
        
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
# Faucet Monitoring
# ==========================================

# Global state to track faucet progress
# Status: "IDLE", "MINING", "VERIFYING", "SUCCESS", "ERROR"
FAUCET_STATE = {
    "status": "IDLE",
    "message": "Ready to start faucet",
    "start_time": None,
    "last_updated": None
}
faucet_lock = threading.Lock()

def faucet_worker(wallet_name, wallet_hotkey):
    global FAUCET_STATE
    
    with faucet_lock:
        FAUCET_STATE["status"] = "MINING"
        FAUCET_STATE["message"] = "Starting PoW mining (this may take 10-20 mins)..."
        FAUCET_STATE["start_time"] = time.time()
        FAUCET_STATE["last_updated"] = time.time()

    try:
        wallet = bt.wallet(name=wallet_name, hotkey=wallet_hotkey)
        sub = get_subtensor()
        
        # This is a blocking call that does the PoW
        # We can't easily get granular progress from the SDK without capturing stdout
        # but we know it's working if it's blocking here.
        success = sub.faucet(wallet=wallet, wait_for_inclusion=True, wait_for_finalization=False)

        with faucet_lock:
            if success:
                FAUCET_STATE["status"] = "SUCCESS"
                FAUCET_STATE["message"] = "Faucet tokens received successfully!"
            else:
                FAUCET_STATE["status"] = "ERROR"
                FAUCET_STATE["message"] = "Faucet failed to verify or include transaction."
            FAUCET_STATE["last_updated"] = time.time()
            
    except Exception as e:
        with faucet_lock:
            FAUCET_STATE["status"] = "ERROR"
            FAUCET_STATE["message"] = f"Faucet error: {str(e)}"
            FAUCET_STATE["last_updated"] = time.time()

class FaucetRequest(BaseModel):
    wallet_name: str
    wallet_hotkey: str = "default"

@app.post("/faucet/start")
def start_faucet(req: FaucetRequest):
    global FAUCET_STATE
    with faucet_lock:
        if FAUCET_STATE["status"] in ["MINING", "VERIFYING"]:
             return {"status": "error", "message": "Faucet is already running"}
        
        # Reset state
        FAUCET_STATE = {
            "status": "STARTING",
            "message": "Initializing...",
            "start_time": time.time(),
            "last_updated": time.time()
        }

    # Start background thread
    t = threading.Thread(target=faucet_worker, args=(req.wallet_name, req.wallet_hotkey), daemon=True)
    t.start()
    
    return {"status": "success", "message": "Faucet process started in background"}

@app.get("/faucet/status")
def get_faucet_status():
    with faucet_lock:
        # Add elapsed time if mining
        elapsed = 0
        if FAUCET_STATE["start_time"]:
            elapsed = int(time.time() - FAUCET_STATE["start_time"])
            
        return {
            "status": FAUCET_STATE["status"],
            "message": FAUCET_STATE["message"],
            "elapsed_seconds": elapsed,
            "updated_at": FAUCET_STATE["last_updated"]
        }

# ==========================================
# Validator / Compute Logic (Phase 4)
# ==========================================

import requests
import threading
import time
import random
from typing import Dict, List

# ... [Original imports remain] ...

# ==========================================
# Validator / Compute Logic (Phase 4)
# ==========================================

class Validator:
    def __init__(self):
        self.scores = {} # Map netuid -> { hotkey -> score }
        self.lock = threading.Lock()
        self.running = True
        self.sub = None 
        # In a real environment, we'd Initialize Subtensor here
        # self.sub = get_subtensor() 

    def check_proxy(self, ip: str, port: int) -> float:
        """
        Verifies a proxy by attempting to connect through it.
        Returns a score between 0.0 and 1.0.
        """
        proxy_url = f"http://{ip}:{port}"
        proxies = {
            "http": proxy_url,
            "https": proxy_url,
        }
        
        target_url = "http://google.com" # Or a dedicated benchmark endpoint
        timeout = 5.0 # 5 seconds max latency

        try:
            start_time = time.time()
            response = requests.get(target_url, proxies=proxies, timeout=timeout)
            end_time = time.time()
            
            latency = end_time - start_time
            
            if response.status_code == 200:
                # Score calculation: 
                # 1.0 = < 0.5s latency
                # 0.5 = < 2.0s latency
                # 0.1 = > 2.0s latency
                
                if latency < 0.5:
                    return 1.0
                elif latency < 2.0:
                    return 0.5
                else:
                    return 0.1
            else:
                 return 0.0 # Connected but failed request
                 
        except Exception as e:
            # print(f"Proxy check failed for {proxy_url}: {e}")
            return 0.0

    def run_validation_loop(self):
        print("Validator: Starting validation loop...")
        while self.running:
            try:
                # In a real subnet, we would:
                # 1. Query metagraph for all registered uids
                # 2. Extract IP/Port from Axon info
                
                # For this implementation, we will simulate fetching from Metagraph
                # but perform REAL HTTP checks if IP is reachable (or simulate check if local)
                
                # Mock Metagraph State (Normally fetched from self.sub.metagraph(netuid))
                # For demo purposes, we define a "Test Set" of proxies checking localhost
                mock_metagraph = {
                    "5F...good": {"ip": "127.0.0.1", "port": 3000}, # Assumed running proxy
                    "5F...bad":  {"ip": "192.0.2.1", "port": 8080}, # Non-routable
                }

                new_scores = {}
                
                for hotkey, info in mock_metagraph.items():
                    # PERFORM REAL CHECK
                    score = self.check_proxy(info["ip"], info["port"])
                    new_scores[hotkey] = score
                    
                    if score > 0:
                        print(f"Validator: Proxy {info['ip']}:{info['port']} is ALIVE! Score: {score}")

                with self.lock:
                    self.scores[1] = new_scores
                
                # In Real Logic:
                # uids = ...
                # weights = [new_scores[k] for k in uids]
                # self.sub.set_weights(netuid=1, uids=uids, weights=weights, ...)
                
                print(f"Validator: Updated scores: {self.scores}")
                time.sleep(60) # Validate every 60s
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
            # Return standardized format for Control API
            "scores": validator.scores.get(netuid, {})
        }

# ... [Rest of file]

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
