# ProxyHub Provider CLI

A high-fidelity command line interface for managing distributed proxy nodes on the ProxyHub network.

## Overview

The Provider CLI allows you to:
- **Register** your node with the ProxyHub Control API
- **Connect** to the Edge Gateway and start serving traffic
- **Monitor** your node's performance and earnings
- **Manage** configuration and system services

## Installation

### From Source

```bash
cd services/control-api/cmd/provider-cli
go build -o provider-cli main.go
mv provider-cli /usr/local/bin/
```

### Using Go Install

```bash
go install github.com/proxyhubb/control-api/cmd/provider-cli@latest
```

## Quick Start

### 1. Interactive Setup Wizard

```bash
provider-cli wizard
```

This will guide you through:
- API authentication setup
- Node registration
- Performance configuration
- System service installation (optional)

### 2. Manual Setup

```bash
# Initialize configuration
provider-cli config init

# Or set values directly
provider-cli config set api_key <your-api-key>
provider-cli config set jwt_token <your-jwt-token>
provider-cli config set gateway_addr gateway.proxyhubb.com:4000

# Register your node
provider-cli node register

# Start serving traffic
provider-cli node start
```

## Commands

### Node Management

| Command | Description |
|---------|-------------|
| `provider-cli node start` | Connect to Edge Gateway and serve traffic |
| `provider-cli node stop` | Stop the running node |
| `provider-cli node list` | List registered nodes |
| `provider-cli node status <id>` | Get node telemetry |
| `provider-cli node register` | Register a new node |
| `provider-cli node metrics` | Display real-time metrics |
| `provider-cli node logs` | View node logs |

### Configuration

| Command | Description |
|---------|-------------|
| `provider-cli config init` | Interactive configuration setup |
| `provider-cli config set <key> <value>` | Set a configuration value |
| `provider-cli config get <key>` | Get a configuration value |
| `provider-cli config show` | Display all configuration |

### System Service

| Command | Description |
|---------|-------------|
| `provider-cli service install` | Install as systemd service (Linux) |
| `provider-cli service uninstall` | Remove systemd service |
| `provider-cli service start` | Start the service |
| `provider-cli service stop` | Stop the service |
| `provider-cli service status` | Check service status |
| `provider-cli service logs` | View service logs |

### Diagnostics

| Command | Description |
|---------|-------------|
| `provider-cli doctor` | Run diagnostics and troubleshooting |
| `provider-cli wizard` | Interactive setup wizard |
| `provider-cli version` | Display version information |

## Configuration

Configuration is stored in `~/.proxyhubb/provider.yaml`.

### Environment Variables

All configuration values can be set via environment variables with the `PROXYHUB_` prefix:

```bash
export PROXYHUB_API_KEY="your-api-key"
export PROXYHUB_JWT_TOKEN="your-jwt-token"
export PROXYHUB_GATEWAY_ADDR="gateway.proxyhubb.com:4000"
```

### Configuration File Example

```yaml
node_id: "node_abc123"
api_key: "ph_live_xxxxxxxx"
jwt_token: "eyJhbGciOiJIUzI1NiIs..."
gateway_addr: "gateway.proxyhubb.com:4000"
use_tls: true
max_connections: 100
bandwidth_limit_mbps: 100
log_level: "info"
metrics_enabled: true
metrics_port: 9090
```

## Starting Your Node

### Basic Usage

```bash
provider-cli node start
```

### With Custom Options

```bash
provider-cli node start \
  --gateway-addr gateway.proxyhubb.com:4000 \
  --jwt-token <your-token> \
  --use-tls \
  --debug
```

### As a System Service (Linux)

```bash
# Install the service
sudo provider-cli service install

# Start the service
sudo systemctl start proxyhub-provider

# Check status
sudo systemctl status proxyhub-provider

# View logs
sudo journalctl -u proxyhub-provider -f
```

## Monitoring

### View Metrics

```bash
provider-cli node metrics
```

### View Logs

```bash
# View log file location
provider-cli node logs

# Follow logs (if running as service)
provider-cli service logs -f
```

### Prometheus Metrics

When enabled, metrics are exposed at `http://localhost:9090/metrics`:

- `provider_active_connections` - Current active connections
- `provider_total_connections` - Total connections served
- `provider_bytes_up` - Total bytes uploaded
- `provider_bytes_down` - Total bytes downloaded

## Troubleshooting

### Run Diagnostics

```bash
provider-cli doctor
```

### Common Issues

**Connection Refused**
- Check that the gateway address is correct
- Verify your network allows outbound connections on port 4000
- Check firewall settings

**Authentication Failed**
- Verify your JWT token is valid and not expired
- Check that your API key has the correct permissions
- Try regenerating your token from the dashboard

**Node Not Appearing in Dashboard**
- Ensure the node completed registration
- Check that heartbeats are being sent (review logs)
- Verify the node is marked as healthy

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Provider CLI                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │   CLI Cmd    │───▶│   Config     │───▶│    Tunnel    │   │
│  │   (cobra)    │    │   (viper)    │    │   Client     │   │
│  └──────────────┘    └──────────────┘    └──────┬───────┘   │
│                                                  │            │
│                       ┌──────────────────────────┤            │
│                       │                          │            │
│                       ▼                          ▼            │
│              ┌──────────────┐           ┌──────────────┐      │
│              │  Heartbeat   │           │   Handler    │      │
│              │   Manager    │           │   (proxy)    │      │
│              └──────────────┘           └──────────────┘      │
│                                                              │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            │ TCP + TLS + Yamux
                            ▼
              ┌─────────────────────────┐
              │     Edge Gateway        │
              │     (Rust/Port 4000)    │
              └─────────────────────────┘
```

## Development

### Building

```bash
cd services/control-api/cmd/provider-cli
go build -ldflags "-X main.BuildTime=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  -X main.GitCommit=$(git rev-parse --short HEAD) \
  -X main.GitBranch=$(git rev-parse --abbrev-ref HEAD)" \
  -o provider-cli main.go
```

### Testing

```bash
go test ./...
```

## License

MIT License - See LICENSE file for details.

## Support

- Documentation: https://docs.proxyhubb.io
- Support: support@proxyhubb.io
- Dashboard: https://app.proxyhubb.io
