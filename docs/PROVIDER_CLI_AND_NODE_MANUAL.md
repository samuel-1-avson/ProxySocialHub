# ProxyHubb Protocol: DePIN Provider CLI & Daemon Operator Manual

**Target Audience**: Bandwidth Providers, Node Operators, and DePIN Miners  
**Version**: 1.0.6  
**Binaries**: `provider-node` (Core Daemon) and `proxyhubb-cli` (Onboarding Helper)  

---

## 1. Introduction

The **ProxyHubb Provider Node** is a lightweight, high-performance daemon written in Rust that allows residential, datacenter, and mobile bandwidth providers to monetize unused network capacity securely.

### Key Features
- **Zero-Touch Onboarding**: Generate signed config files in 1 second via `proxyhubb-cli join`.
- **Yamux Multiplexing**: Handles hundreds of concurrent buyer requests over persistent, encrypted TCP/TLS tunnels.
- **Cryptographic Heartbeats**: Signs periodic proof-of-uptime telemetry with an on-device Ed25519 keypair.
- **Multi-Gateway Failover**: Automatically cycles through backup edge gateways if an outage occurs.
- **Interactive TUI Dashboard**: Real-time ASCII bandwidth graphs and earnings counters.
- **OS Service Integration**: Runs automatically on system boot via `systemd` (Linux) or Windows Startup Services.

---

## 2. Quick Start Guide

### Option A: Windows (Desktop UI / Double-Click)
1. Download `provider-node-1.0.6-windows-amd64.zip` from [ProxyHubb Releases](https://proxyhubb.com/dashboard/provider/cli).
2. Extract the ZIP archive into a folder.
3. Obtain your Node Key from **[Dashboard → Become a Provider → Connect](https://proxyhubb.com/dashboard/become-provider)**.
4. Run:
   ```cmd
   proxyhubb-cli.exe join --key YOUR_API_KEY --node-id YOUR_NODE_ID
   ```
5. Double-click **`Launch-Provider-Console.cmd`** to launch the interactive live console.

---

### Option B: Linux & macOS (Terminal)
```bash
# 1. Download and make executable
curl -fsSL https://proxyhubb.com/download/provider-node-linux-amd64 -o provider-node
chmod +x provider-node

# 2. Join the network (creates ~/.config/proxyhubb/provider.toml)
./provider-node join --api-key YOUR_API_KEY --node-id YOUR_NODE_ID

# 3. Start the node daemon
./provider-node start

# 4. View live dashboard
./provider-node dashboard
```

---

## 3. CLI Command Reference

### `join`
Configures a fresh `provider.toml` using your API credentials:
```bash
provider-node join \
  --api-key "phb_live_..." \
  --node-id "node-uuid-..." \
  --api-url "https://api.proxyhubb.com" \
  --gateway-addr "proxy.proxyhubb.com:3128"
```

### `start`
Starts serving proxy bandwidth through the edge gateway:
```bash
# Standard startup (reads provider.toml)
provider-node start

# Multi-gateway failover startup
provider-node start --gateway-addrs "gw1.proxyhubb.com:3128,gw2.proxyhubb.com:3128"

# With TLS encryption enabled
provider-node start --use-tls
```

### `doctor`
Runs pre-flight diagnostics to ensure your network and firewall are configured properly:
```bash
provider-node doctor
```
Checks performed:
- ✓ Control API reachability and TLS certificate validation.
- ✓ Edge Gateway port 3128 connectivity.
- ✓ Outbound NAT traversal & STUN candidate resolution.
- ✓ Token validity & lease issuance.
- ✓ Port 9090 Prometheus metrics server availability.

### `dashboard`
Launches the full-screen terminal UI displaying real-time throughput, active Yamux tunnels, and total rewards earned:
```bash
provider-node dashboard --refresh-ms 500
```

### `status`
Displays local daemon status, memory usage, and connected edge nodes:
```bash
provider-node status
provider-node status --json
```

### `update`
Performs an in-place upgrade to the latest released binary:
```bash
provider-node update
```

### `service`
Installs or uninstalls `provider-node` as a background OS service:
```bash
# Install as systemd service (Linux)
sudo provider-node service install

# Start the background service
sudo systemctl start proxyhub-provider
```

---

## 4. Configuration File (`provider.toml`)

The configuration file is stored in:
- **Windows**: `%APPDATA%\proxyhubb\provider.toml`
- **Linux/macOS**: `~/.config/proxyhubb/provider.toml`

```toml
# ProxyHubb Provider Node Configuration
control_api_url = "https://api.proxyhubb.com"
gateway_addr = "proxy.proxyhubb.com:3128"
gateway_addrs = [
  "proxy-us.proxyhubb.com:3128",
  "proxy-eu.proxyhubb.com:3128"
]
api_key = "phb_live_your_secret_key"
node_id = "node-550e8400-e29b-41d4-a716-446655440000"
provider_signing_key = "5M9xP7g2tV8qK3rN4wX1zY6bC8vD9fJ2sA4eH7kL3mP6"
connection_type = "residential"
use_tls = true
metrics_port = 9090
```

---

## 5. Rewards & Proof-of-Bandwidth Mining

Bandwidth earnings are calculated through on-chain cryptographic state channels and Proof-of-Bandwidth mining epochs:

1. **Active Routing Fees**: You earn instant lamports for every megabyte routed through your node.
2. **Epoch Mining Rewards**: At the close of each epoch (every 24 hours), the Solana on-chain program (`AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu`) distributes pool emissions based on your verified bytes served.
3. **Withdrawals**: View balance and withdraw directly to your Solana wallet via **[Dashboard → Wallet](https://proxyhubb.com/dashboard/wallet)**.

---

## 6. Troubleshooting & FAQ

### Q: `doctor` reports "Edge Gateway Port 3128 unreachable"
- Ensure your outbound firewall allows outbound TCP traffic on port `3128` and `8090`.
- If your ISP blocks port 3128, start the daemon with TLS over port 443:
  ```bash
  provider-node start --gateway-addr "proxy.proxyhubb.com:8443" --use-tls
  ```

### Q: How can I limit bandwidth usage?
- You can set max bandwidth caps directly in your `provider.toml`:
  ```toml
  max_upload_mbps = 50
  max_monthly_gb = 500
  ```

### Q: Where do I view Prometheus metrics?
- The daemon exposes standard Prometheus metrics locally at `http://localhost:9090/metrics`.
