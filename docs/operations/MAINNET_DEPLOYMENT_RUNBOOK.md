# ProxyHubb: Solana Mainnet-Beta Deployment & Operations Runbook

This runbook defines the authoritative, step-by-step operational procedure for deploying, configuring, and operating the **ProxyHubb DePIN Protocol** on **Solana Mainnet-Beta**.

---

## 1. Pre-Flight Checklist & Security Prerequisites

| Step | Requirement | Target / Tool | Verified By |
|---|---|---|---|
| **1.1** | Verifiable Build | `anchor build --verifiable` | Deterministic SHA-256 binary hash |
| **1.2** | Key Custody | GCP Cloud KMS / AWS KMS (HSM Protection Level) | Zero plaintext keyfiles on disk |
| **1.3** | Multisig Authority | Squads v4 / Realms (3-of-5 threshold) | Upgrade authority transferred from deployer |
| **1.4** | RPC Redundancy | Minimum 2 independent keyed providers (Helius + Triton/QuickNode) | Failover latency < 250ms |
| **1.5** | Database HA | PostgreSQL 16+ Primary with Streaming Replication | Automated failover drill passed |
| **1.6** | Cache HA | Redis Sentinel Cluster (1 Master, 2 Replicas, 3 Sentinels) | Chaos failover drill passed |

---

## 2. Phase 1: Hardware-Backed Cloud KMS Provisioning

### 2.1. Provision Cloud KMS Keyring and Ed25519 Signing Keys
```bash
# Set GCP Project and Region
export PROJECT="proxyhubb-prod"
export LOCATION="us-central1"
export KEYRING="proxyhubb-mainnet-keys"

# Create Keyring
gcloud kms keyrings create "$KEYRING" --location="$LOCATION" --project="$PROJECT"

# Create Oracle HSM Key (Asymmetric Signing Ed25519)
gcloud kms keys create "oracle-mainnet-ed25519" \
  --keyring="$KEYRING" \
  --location="$LOCATION" \
  --project="$PROJECT" \
  --purpose=asymmetric-signing \
  --default-algorithm=ec-sign-ed25519 \
  --protection-level=hsm

# Create Hot Treasury HSM Key
gcloud kms keys create "treasury-hot-mainnet-ed25519" \
  --keyring="$KEYRING" \
  --location="$LOCATION" \
  --project="$PROJECT" \
  --purpose=asymmetric-signing \
  --default-algorithm=ec-sign-ed25519 \
  --protection-level=hsm
```

### 2.2. Grant Control API VM Service Account Permissions
```bash
export VM_SA="proxyhubb-control-api-sa@${PROJECT}.iam.gserviceaccount.com"

# Grant Signer & Verifier Roles
gcloud kms keys add-iam-policy-binding "oracle-mainnet-ed25519" \
  --keyring="$KEYRING" \
  --location="$LOCATION" \
  --member="serviceAccount:${VM_SA}" \
  --role="roles/cloudkms.signerVerifier"

gcloud kms keys add-iam-policy-binding "treasury-hot-mainnet-ed25519" \
  --keyring="$KEYRING" \
  --location="$LOCATION" \
  --member="serviceAccount:${VM_SA}" \
  --role="roles/cloudkms.signerVerifier"
```

---

## 3. Phase 2: Solana Mainnet Smart Contract Deployment

### 3.1. Build Deterministic Program Binary
```bash
cd services/solana-programs/proxyhub
anchor build --verifiable

# Confirm Program ID matches canonical deployment address
solana address -k target/deploy/proxyhub-keypair.json
```

### 3.2. Deploy to Solana Mainnet-Beta
```bash
export RPC_URL="https://mainnet.helius-rpc.com/?api-key=YOUR_PROD_KEY"

solana program deploy \
  --program-id target/deploy/proxyhub-keypair.json \
  target/deploy/proxyhub.so \
  --url "$RPC_URL" \
  --max-len 300000
```

### 3.3. Initialize On-Chain Program State & Deposit Vault
```bash
# Initialize program state with initial multisig admin and deposit vault PDA
npx ts-node scripts/init-program-state-mainnet.ts
```

### 3.4. Transfer Upgrade Authority to Squads Timelock Multisig
```bash
export SQUADS_MULTISIG="Squads4MainnetVaultAddress111111111111111111"

solana program set-upgrade-authority \
  AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu \
  --new-upgrade-authority "$SQUADS_MULTISIG" \
  --url "$RPC_URL"
```

---

## 4. Phase 3: Control API & Decentralization Enforcements

Deploy `.env` on production nodes copying from [`config/mainnet.env.example`](file:///f:/project/proxyhubb/config/mainnet.env.example):

```ini
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_ENDPOINT=https://mainnet.helius-rpc.com/?api-key=...
SOLANA_RPC_ENDPOINTS=https://mainnet.helius-rpc.com/?api-key=...,https://solana-mainnet.rpc.extrnode.com

# Fail-Closed Decentralization Enforcements
FULL_DECENTRALIZATION=true
PROXYHUB_PROVIDER_REGISTRY_GATE=enforce
PROXYHUB_JOURNAL_AS_SOT=true
PROXYHUB_LISTING_COMMITMENT=enforce
PROXYHUB_GATEWAY_OPERATOR_BOND_ENFORCE=enforce
PROXYHUB_OPERATOR_MANIFEST=enforce
```

---

## 5. Phase 4: Staked Gateway Operator Network Activation

### 5.1. Bootstrapping Gateway Bond PDAs
Third-party operators deposit stake directly to join the data plane:
```bash
# Gateway operator deposits 2.0 SOL stake to create GatewayRegistry PDA
npx tsx scripts/w12b-permissionless-join.ts \
  --stake-sol 2.0 \
  --endpoint "https://gateway-useast.proxyhubb.net:8090"
```

---

## 6. Phase 5: Verification & Production Smoke Tests

Execute the automated pre-flight and live smoke verification:
```bash
# Run automated pre-flight checks
(cd services/control-api && APP_ENV=testnet go run ./cmd/preflight -web-env /path/to/web.env)

# Execute end-to-end micro-session settlement test
npx tsx testing/test_depin_ecosystem.ts
```

---

## 7. Emergency Incident Response & Circuit Breakers

1. **Paused State:** If an exploit or oracle compromise is detected, the Squads Multisig executes `pause_program()` to immediately freeze escrow creation and withdrawals.
2. **Key Rotation:** If an oracle key version needs rotation, the Squads multisig votes on `execute_signer_rotation_proposal()`.
3. **Slashing Dispute:** Malicious edge gateways tampering with proxy traffic are slashed via `slash_gateway()`, sending confiscated stake to the protocol treasury and auto-deactivating the operator.
