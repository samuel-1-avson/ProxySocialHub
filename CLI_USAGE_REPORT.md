# ProxyHub CLI System - Comprehensive Analysis & Usage Report

## 1. System Overview
The **ProxyHub Provider CLI** is a high-fidelity command-line tool designed for bandwidth providers to interact with the ProxyHub network. It serves as the primary interface for registering hardware as a "Node," establishing secure tunnels to the Edge Gateway, and monitoring real-time performance and earnings.

The CLI acts as a **bridge** between the provider's local machine and the decentralized ProxyHub infrastructure, handling complex networking tasks like multiplexing (Yamux), encryption (TLS), and automated heartbeats.

---

## 2. Architecture & How It Works

### Core Components
- **Command Engine (Cobra):** Manages the command-line interface, providing a nested structure of commands (e.g., `node start`, `config set`).
- **Configuration Manager (Viper):** Handles settings stored in `~/.proxyhubb/provider.yaml`, environment variables (`PROXYHUB_*`), and flag overrides.
- **Tunnel Client:** Establishes a persistent TCP+TLS connection to the **Edge Gateway**. It uses the **Yamux** multiplexer to allow multiple proxy streams over a single connection.
- **Heartbeat Manager:** Sends periodic "pulses" to the Control API to signal that the node is alive, reporting current latency, CPU usage, and bandwidth availability.
- **Telemetry Engine:** Exposes a local Prometheus endpoint (default: `:9090`) for real-time monitoring of traffic stats.

### Data Flow
1. **Authentication:** The CLI uses an `api_key` or `jwt_token` to authenticate with the **Control API**.
2. **Registration:** On first run, the CLI registers the local machine's metadata (OS, CPU, RAM) to receive a unique `node_id`.
3. **Tunneling:** When `node start` is issued, the CLI connects to the **Edge Gateway**, completes a handshake, and waits for incoming proxy requests.
4. **Traffic Handling:** For every incoming stream from the gateway, the CLI spawns a lightweight handler to route traffic to the intended destination (HTTP/SOCKS5).

---

## 3. Key Features
- **Interactive Wizard:** A step-by-step setup guide for beginners (`provider-cli wizard`).
- **Node Lifecycle Management:** Register, start, stop, and monitor nodes with simple commands.
- **Automated Service Installation:** Can be installed as a **systemd service** on Linux to ensure it starts automatically on boot.
- **Built-in Diagnostics:** The `doctor` command runs a suite of health checks to identify firewall issues, network latency, or configuration errors.
- **Real-time Metrics:** Integrated dashboard for viewing upload/download speeds and active connections.

---

## 4. How to Use the ProxyHub CLI

### Installation
Currently, the CLI can be built from source:
```bash
cd services/control-api/cmd/provider-cli
go build -o provider-cli main.go
sudo mv provider-cli /usr/local/bin/
```

### Initial Setup (The Easy Way)
For most users, the **Interactive Wizard** is the best starting point:
```bash
provider-cli wizard
```
Follow the prompts to enter your API key, select your preferred network settings, and register your node.

### Manual Setup (For Advanced Users)
1. **Initialize Config:**
   ```bash
   provider-cli config init
   provider-cli config set api_key <YOUR_API_KEY>
   ```
2. **Register Node:**
   ```bash
   provider-cli node register
   ```
3. **Start Serving Traffic:**
   ```bash
   provider-cli node start --use-tls
   ```

### Daily Operations
- **Check Status:** `provider-cli node list`
- **View Real-time Stats:** `provider-cli node metrics`
- **Troubleshooting:** `provider-cli doctor`
- **Updating Settings:** `provider-cli config set bandwidth_limit_mbps 500`

---

## 5. Security Best Practices
- **Token Protection:** Never share your `provider.yaml` or `jwt_token`. The CLI securely reads these from your home directory.
- **TLS Encryption:** Always run with the `--use-tls` flag in production to protect proxied traffic from eavesdropping.
- **Environment Variables:** For cloud deployments, prefer setting `PROXYHUB_API_KEY` as an environment variable rather than storing it in a file.

---

## 6. System Rating: ★★★★☆ (4.8/5)
The ProxyHub CLI is exceptionally well-structured for a DePIN project. Using **Cobra/Viper** ensures industry-standard UX, while the **Yamux-based tunneling** provides excellent performance on low-end hardware (like Raspberry Pis). The inclusion of a `doctor` command and an interactive `wizard` significantly lowers the barrier to entry for non-technical providers.

**Recommendation:** For production environments, utilize the `service install` command to ensure maximum uptime and automated recovery.
