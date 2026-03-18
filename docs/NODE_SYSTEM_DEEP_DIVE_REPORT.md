# Node System Deep Dive Report

## ProxyHubb Proxy App - Node Architecture Analysis

**Report Date:** March 15, 2026  
**Author:** AI Assistant  
**System:** ProxyHubb - Decentralized Proxy Marketplace  

---

## Table of Contents

1. [What is a Node?](#1-what-is-a-node)
2. [Node Function & Purpose](#2-node-function--purpose)
3. [How Nodes are Set Up](#3-how-nodes-are-set-up)
4. [How Nodes Work Inside the Proxy App](#4-how-nodes-work-inside-the-proxy-app)
5. [How People Connect to Nodes](#5-how-people-connect-to-nodes)
6. [Node Lifecycle & Operations](#6-node-lifecycle--operations)
7. [Node Scoring & Selection](#7-node-scoring--selection)
8. [Health Monitoring & Heartbeats](#8-health-monitoring--heartbeats)
9. [Architecture Diagrams](#9-architecture-diagrams)
10. [Key Data Structures](#10-key-data-structures)

---

## 1. What is a Node?

A **Node** in the ProxyHubb system is a **provider endpoint** that acts as an exit point for proxy traffic. Think of it as a server or computer that:

- Accepts proxied internet requests from the Edge Gateway
- Forwards those requests to the actual destination (websites, APIs, etc.)
- Returns the responses back through the Edge Gateway to the end user
- Earns cryptocurrency (SOL) for providing bandwidth

### Node Types

Nodes can be classified by their connection type:

| Type | Description | Use Case |
|------|-------------|----------|
| **residential** | Home internet connections | High anonymity, bypass geo-blocks |
| **mobile** | Cellular/4G/5G connections | Rotating IPs, social media automation |
| **datacenter** | Server/cloud infrastructure | High speed, reliable connections |
| **fiber** | Fiber optic connections | Premium speed and reliability |
| **cable** | Cable internet connections | Good balance of speed and availability |

### Node Identity

Each node has a unique identity consisting of:

```rust
pub struct NodeInfo {
    pub node_id: String,           // Unique identifier (e.g., "node_user123")
    pub user_id: Option<String>,   // Provider's user ID
    pub country_code: String,      // ISO 3166-1 alpha-2 (e.g., "GH", "US")
    pub region: String,            // City/region name (e.g., "Accra", "New York")
    pub ip_address: String,        // Public IP address
    pub connected_at: u64,         // Unix timestamp of connection
    pub is_healthy: bool,          // Health status
    // ... additional fields
}
```

---

## 2. Node Function & Purpose

### Primary Functions

1. **Traffic Forwarding**: Receive HTTP/HTTPS requests from the Edge Gateway and forward them to destination websites

2. **Anonymization**: Mask the original user's IP address by replacing it with the node's IP

3. **Geo-Unblocking**: Provide access to content restricted to specific geographic locations

4. **Bandwidth Provision**: Sell unused internet bandwidth to consumers

5. **Request Routing**: Handle multiple concurrent connections efficiently

### Node as a Network Participant

```
┌─────────────────────────────────────────────────────────────────┐
│                        PROXY REQUEST FLOW                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Consumer          Edge Gateway           Node          Target │
│      │                  │                   │             │     │
│      │  HTTP CONNECT   │                   │             │     │
│      │────────────────▶│                   │             │     │
│      │                 │  Select Best Node │             │     │
│      │                 │──────────────────▶│             │     │
│      │                 │                   │             │     │
│      │                 │   Open Yamux Stream to Node     │     │
│      │                 │─────────────────────────────────▶│     │
│      │                 │                   │  CONNECT    │     │
│      │                 │                   │────────────▶│     │
│      │                 │                   │             │     │
│      │                 │                   │  Response   │     │
│      │                 │◀────────────────────────────────│     │
│      │  200 OK         │                   │             │     │
│      │◀────────────────│                   │             │     │
│      │                 │                   │             │     │
│      │  Data Tunnel ─────────────────────────────────────▶│     │
│      │◀───────────────────────────────────────────────────│     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. How Nodes are Set Up

### Provider Onboarding Process

#### Step 1: Account Creation
- Provider creates an account on ProxyHubb
- Completes KYC (Know Your Customer) verification
- Links Solana wallet for earnings

#### Step 2: Node Registration via CLI

```bash
# Install the provider CLI
go install github.com/proxyhubb/provider-cli@latest

# Configure API credentials
provider-cli config set api_key "your-api-key"
provider-cli config set api_url "https://api.proxyhubb.com"

# Register a new node
provider-cli node register
```

The registration process (from `provider-cli/cmd/node.go`):

```go
var registerCmd = &cobra.Command{
    Use:   "register",
    Short: "Interactive helper to register a new node",
    Run: func(cmd *cobra.Command, args []string) {
        fmt.Println("--- ProxyHub Node Registration ---")
        var ip, typeName string
        var port int

        fmt.Print("Enter Public IP Address: ")
        fmt.Scanln(&ip)
        fmt.Print("Enter Port: ")
        fmt.Scanln(&port)
        fmt.Print("Enter Node Type (residential/mobile/datacenter): ")
        fmt.Scanln(&typeName)

        // Send registration request to Control API
        payload := map[string]interface{}{
            "ip_address":      ip,
            "port":            port,
            "connection_type": typeName,
        }
        // ... HTTP POST to /v1/provider/nodes
    },
}
```

#### Step 3: Node Entry in Database

The Control API creates a node record in PostgreSQL:

```go
type Node struct {
    ID                uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
    ProviderUserID    uuid.UUID `gorm:"type:uuid;index" json:"provider_user_id"`
    IPAddress         string    `gorm:"type:varchar(45)" json:"ip_address"`
    Port              int       `json:"port"`
    Protocol          string    `gorm:"type:varchar(10);default:'http'" json:"protocol"`
    CountryCode       string    `gorm:"type:varchar(10)" json:"country_code"`
    Region            string    `gorm:"type:varchar(100)" json:"region"`
    City              string    `gorm:"type:varchar(100)" json:"city"`
    ISP               string    `gorm:"type:varchar(100)" json:"isp"`
    ConnectionType    string    `gorm:"type:varchar(50)" json:"connection_type"`
    IsHealthy         bool      `gorm:"default:true" json:"is_healthy"`
    ActiveConnections int       `json:"active_connections"`
    MaxConnections    int       `gorm:"default:100" json:"max_connections"`
    LatencyMs         int       `json:"latency_ms"`
    TotalBytesUp      int64     `json:"total_bytes_up"`
    TotalBytesDown    int64     `json:"total_bytes_down"`
    UptimePercent     float64   `gorm:"default:100" json:"uptime_percent"`
    SuccessRate       float64   `gorm:"default:1.0" json:"success_rate"`
    QualityScore      float64   `gorm:"default:100" json:"quality_score"`
    LastSeenAt        time.Time `json:"last_seen_at"`
}
```

#### Step 4: Provider Software Connection

The provider runs software (desktop app or CLI) that:

1. **Establishes a TCP connection** to the Edge Gateway tunnel port (default: 4000)
2. **Performs TLS handshake** (optional but recommended)
3. **Sends authentication** with JWT token
4. **Declares capabilities** (bandwidth, CPU, memory)
5. **Maintains persistent connection** via Yamux multiplexing

---

## 4. How Nodes Work Inside the Proxy App

### The Edge Gateway Architecture

The Edge Gateway is the Rust-based proxy server that manages all nodes. It's located at `services/edge-gateway/`.

```
services/edge-gateway/
├── src/
│   ├── main.rs              # HTTP proxy server (port 3128)
│   ├── tunnel.rs            # Provider tunnel server (port 4000)
│   ├── state.rs             # Node registry and AppState
│   ├── heartbeat.rs         # Health monitoring
│   ├── registry/
│   │   ├── lockfree.rs      # Lock-free node registry
│   │   └── store.rs         # Redis persistence
│   └── ...
```

### Node Registry Components

#### 1. Lock-Free Node Registry

The `LockFreeNodeRegistry` uses `DashMap` for high-concurrency access:

```rust
pub struct LockFreeNodeRegistry {
    nodes: DashMap<String, Arc<NodeEntry>>,
    /// Pre-sorted (score desc) list for O(1) selection
    top_nodes: Arc<std::sync::RwLock<Vec<(String, Control)>>>,
}

pub struct NodeEntry {
    pub control: Control,                    // Yamux control channel
    pub info: RwLock<NodeInfo>,              // Node metadata
    pub last_heartbeat: AtomicU64,           // Last heartbeat timestamp
    pub active_connections: AtomicU32,       // Live connection count
    pub is_healthy: AtomicBool,              // Health flag
}
```

#### 2. Redis Persistence

Node metadata is persisted to Redis for:
- Surviving gateway restarts
- Cross-gateway visibility (in multi-gateway deployments)
- Reputation tracking across sessions

```rust
pub struct RegistryStore {
    conn: ConnectionManager,      // Persistent Redis connection
    raw_client: redis::Client,
}

// Key format: "node:{user_id}:info"
// TTL: 7 days of inactivity
```

### The Tunnel Server (tunnel.rs)

The tunnel server handles provider connections:

```rust
pub async fn run_tunnel_server(port: u16, state: Arc<AppState>) -> Result<(), Box<dyn Error + Send + Sync>> {
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await?;
    
    // TLS setup (optional)
    let tls_acceptor = if is_tls_enabled() { /* ... */ } else { None };
    
    loop {
        let (stream, peer_addr) = listener.accept().await?;
        let state = state.clone();
        
        tokio::spawn(async move {
            handle_provider_connection(stream, peer_addr, state).await;
        });
    }
}
```

### Provider Connection Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                  PROVIDER CONNECTION LIFECYCLE                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. TCP CONNECT                                                  │
│     Provider ───────────────────────────────▶ Edge Gateway       │
│                                                                  │
│  2. TLS HANDSHAKE (optional)                                     │
│     Provider ◀──────────────────────────────▶ Edge Gateway       │
│                                                                  │
│  3. YAMUX SESSION                                                │
│     Multiplexed streams established over TCP                     │
│                                                                  │
│  4. AUTHENTICATION                                               │
│     Provider: "AUTH <JWT_TOKEN>"                                 │
│     Gateway validates JWT with Control API                       │
│     Gateway: "OK"                                                │
│                                                                  │
│  5. CAPABILITY DECLARATION                                       │
│     Provider: "CAPABILITY {"max_connections":500,...}"          │
│     Gateway calculates assigned limits                           │
│     Gateway: "ACK {"max_connections":200,...}"                  │
│                                                                  │
│  6. GEOIP LOOKUP                                                 │
│     Gateway detects country/region from IP                       │
│     (MaxMind GeoIP or heuristic fallback)                        │
│                                                                  │
│  7. NODE REGISTRATION                                            │
│     - Create NodeInfo struct                                     │
│     - Insert into LockFreeNodeRegistry                           │
│     - Persist to Redis                                           │
│     - Register with HeartbeatMonitor                             │
│     - Send registration to Control API                           │
│                                                                  │
│  8. HEARTBEAT LOOP                                               │
│     Provider sends HEARTBEAT every 30 seconds                    │
│     Gateway updates health status                                │
│                                                                  │
│  9. TRAFFIC HANDLING                                             │
│     Gateway opens yamux streams to route consumer requests       │
│     Provider forwards traffic to destination websites            │
│                                                                  │
│  10. DISCONNECT                                                  │
│     - Persist final stats to Redis                               │
│     - Remove from registry                                       │
│     - Mark as offline in Control API                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. How People Connect to Nodes

### Consumer Connection Flow

When a consumer wants to use the proxy service, they follow this flow:

#### Step 1: Authentication

Consumer sends HTTP CONNECT request with credentials:

```http
CONNECT example.com:443 HTTP/1.1
Host: example.com:443
Proxy-Authorization: Basic base64(username:password)
```

#### Step 2: Session Validation

The Edge Gateway validates the session:

```rust
// Extract credentials from Proxy-Authorization header
let credentials = extract_proxy_auth(req.headers().get(PROXY_AUTHORIZATION));

// Validate against Redis
match authenticator.validate_session(&username, false).await {
    Ok(Some(session)) => {
        // Session valid - proceed
    }
    Ok(None) => {
        // Invalid session - return 407
    }
    Err(e) => {
        // Backend error - fail closed (return 407)
    }
}
```

#### Step 3: Provider Selection

The gateway selects the best available node:

```rust
async fn select_best_provider(
    state: Arc<AppState>,
    session_id: &str,
    is_sticky: bool,
) -> Result<Option<(yamux::Control, String)>> {
    
    // 1. Check sticky binding (if session type is sticky)
    let sticky_node_id = if is_sticky {
        authenticator.get_sticky_node(session_id).await?
    } else { None };
    
    // 2. Select provider based on strategy
    let selection = if let Some(node_id) = sticky_node_id {
        // Use bound node
        state.registry.get_by_id(&node_id)
            .map(|c| (c, node_id))
            .or_else(|| state.registry.get_best())
    } else if let Some((control, node_id)) = state.select_provider_ml() {
        // ML-based routing
        Some((control, node_id))
    } else if let Some(control) = state.registry.get_random() {
        // Random fallback
        Some((control, "random".to_string()))
    } else {
        None
    };
    
    // 3. Bind sticky session if new
    if is_sticky && sticky_node_id.is_none() {
        authenticator.set_sticky_node(session_id, &node_id, ttl).await?;
    }
    
    Ok(selection)
}
```

#### Step 4: Return 200 OK

```http
HTTP/1.1 200 OK

[Upgrade to tunnel mode]
```

#### Step 5: Traffic Bridging

The gateway bridges traffic between consumer and provider:

```rust
// Open yamux stream to provider
let mut stream = control.open_stream().await?;

// Send CONNECT command to provider
stream.write_all(format!("CONNECT {}\n", addr).as_bytes()).await?;

// Wait for provider's OK
let mut response_buf = [0u8; 64];
let n = stream.read(&mut response_buf).await?;

// Bridge bidirectionally with zero-copy
tokio::select! {
    // Client → Provider
    n = client.read(&mut buf_cp) => {
        provider.write_all(&buf_cp[..n]).await?;
    }
    // Provider → Client  
    n = provider.read(&mut buf_pc) => {
        client.write_all(&buf_pc[..n]).await?;
    }
}
```

### Selection Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| **Best** | Highest score based on latency, load, bandwidth | Default for most users |
| **Random** | Uniform random among healthy nodes | Load distribution testing |
| **LeastLoaded** | Fewest active connections | Ensures even distribution |
| **ByCountry** | Specific country code | Geo-specific requirements |
| **ByRegion** | Specific region/city | Ultra-local targeting |
| **Sticky** | Same node for session duration | Stateful applications |
| **ML-Routed** | Machine learning prediction | Optimized performance |

---

## 6. Node Lifecycle & Operations

### Lifecycle States

```
┌─────────────┐    connect      ┌─────────────┐
│   OFFLINE   │────────────────▶│  CONNECTING │
└─────────────┘                 └──────┬──────┘
      ▲                                │
      │                                │ auth success
      │                                ▼
      │                         ┌─────────────┐     health check
      │                         │   HEALTHY   │◀────────┐
      │                         └──────┬──────┘         │
      │                           │    │                │
      │              no heartbeat │    │ heartbeat      │
      │                           ▼    │                │
      │                         ┌─────────────┐         │
      │                         │  UNHEALTHY  │─────────┘
      │                         └──────┬──────┘
      │                                │
      │ disconnect                     │ recover
      │                                │
      └────────────────────────────────┘
```

### Key Operations

#### Registration

```rust
pub fn insert(&self, node_id: String, control: Control, info: NodeInfo) {
    info!("Registered node: {} from {} ({})", node_id, info.region, info.country_code);
    
    // Insert into DashMap (lock-free)
    self.nodes.insert(node_id, Arc::new(NodeEntry::new(control, info)));
    
    // Rebuild score snapshot for O(1) selection
    self.rebuild_score_snapshot();
}
```

#### Health Updates

```rust
pub fn mark_healthy(&self, node_id: &str) {
    if let Some(entry) = self.nodes.get(node_id) {
        entry.is_healthy.store(true, Ordering::Relaxed);
    }
    self.rebuild_score_snapshot();
}

pub fn mark_unhealthy(&self, node_id: &str) {
    if let Some(entry) = self.nodes.get(node_id) {
        entry.is_healthy.store(false, Ordering::Relaxed);
    }
    self.rebuild_score_snapshot();
}
```

#### Connection Counting

```rust
pub fn update_active_connections(&self, node_id: &str, delta: i32) {
    if let Some(entry) = self.nodes.get(node_id) {
        if delta > 0 {
            entry.active_connections.fetch_add(delta as u32, Ordering::Relaxed);
        } else {
            entry.active_connections.fetch_sub((-delta) as u32, Ordering::Relaxed);
        }
    }
}
```

---

## 7. Node Scoring & Selection

### Scoring Algorithm

The node score determines routing priority:

```rust
pub fn score(&self) -> u32 {
    if !self.is_healthy {
        return 0;
    }

    let mut score = 1000u32;

    // QoS tier bonus
    score += match self.qos_tier.as_str() {
        "premium" => 200,
        "standard" => 100,
        "basic" => 0,
        "limited" => -50i32 as u32,
        _ => 0,
    };

    // Priority bonus
    score += self.assigned_limits.priority as u32;

    // Bandwidth capacity bonus
    let bw_score = (self.capabilities.downlink_speed_kbps / 1000).min(100);
    score += bw_score;

    // Penalize high latency
    score = score.saturating_sub(self.latency_ms);

    // Penalize high load
    let load_percent = (self.active_connections * 100) / self.max_connections.max(1);
    score = score.saturating_sub(load_percent * 5);

    // Penalize high bandwidth usage
    let bw_penalty = self.bandwidth_rate_kbps / 100;
    score = score.saturating_sub(bw_penalty);

    // Fresh node bonus (first 24 hours)
    let uptime_hours = (now_secs - self.connected_at) / 3600;
    if uptime_hours < 24 {
        score += 50;
    }

    score
}
```

### Score Breakdown

| Factor | Impact | Range |
|--------|--------|-------|
| Base score | Starting point | 1000 |
| QoS tier | Premium bonus | +0 to +200 |
| Priority | Configured priority | +0 to +100 |
| Bandwidth | Downlink speed bonus | +0 to +100 |
| Latency | Penalty per ms | -latency_ms |
| Load | Penalty based on utilization | -0 to -500 |
| Bandwidth usage | Penalty per 100KB/s | -usage/100 |
| Fresh node | New node bonus | +50 |

### Selection Methods

```rust
impl LockFreeNodeRegistry {
    /// O(1) selection from pre-sorted snapshot
    pub fn get_best(&self) -> Option<(Control, String)> {
        if let Ok(top) = self.top_nodes.read() {
            for (id, ctrl) in top.iter() {
                if let Some(entry) = self.nodes.get(id) {
                    if entry.is_healthy.load(Ordering::Relaxed) {
                        return Some((ctrl.clone(), id.clone()));
                    }
                }
            }
        }
        // Fallback to O(n) scan
        self.fallback_best()
    }

    /// Random selection among healthy nodes
    pub fn get_random(&self) -> Option<Control> {
        let mut rng = rand::thread_rng();
        self.nodes
            .iter()
            .filter(|e| e.value().is_healthy.load(Ordering::Relaxed))
            .choose(&mut rng)
            .map(|e| e.value().control.clone())
    }

    /// Least-loaded selection
    pub fn get_least_loaded(&self) -> Option<Control> {
        self.nodes
            .iter()
            .filter(|e| {
                let entry = e.value();
                let active = entry.active_connections.load(Ordering::Relaxed);
                let max = entry.info.read().map(|i| i.max_connections).unwrap_or(100);
                entry.is_healthy.load(Ordering::Relaxed) && active < max
            })
            .min_by_key(|e| e.value().active_connections.load(Ordering::Relaxed))
            .map(|e| e.value().control.clone())
    }
}
```

---

## 8. Health Monitoring & Heartbeats

### Heartbeat System Architecture

The heartbeat system has two layers:

1. **In-Memory HeartbeatMonitor** - Fast local health tracking
2. **Redis HeartbeatStore** - Distributed persistence

### Heartbeat Configuration

```rust
pub struct HeartbeatConfig {
    /// Expected heartbeat interval from providers
    pub expected_interval: Duration,    // 30 seconds
    /// Timeout after which provider is considered stale
    pub timeout: Duration,              // 60 seconds
    /// Number of missed heartbeats before eviction
    pub max_missed_heartbeats: u32,     // 3
    /// Check interval for the monitor
    pub check_interval: Duration,       // 10 seconds
}
```

### Heartbeat Message Format

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct HeartbeatMessage {
    pub node_id: String,
    pub timestamp: u64,
    pub active_connections: u32,
    pub bandwidth_usage: BandwidthUsage,
    pub system_stats: SystemStats,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BandwidthUsage {
    pub bytes_up: u64,
    pub bytes_down: u64,
    pub rate_kbps: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemStats {
    pub cpu_percent: f32,
    pub memory_percent: f32,
    pub uptime_seconds: u64,
}
```

### Heartbeat Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     HEARTBEAT FLOW                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Provider                  Edge Gateway         Redis          │
│      │                          │                 │             │
│      │  HEARTBEAT:node:1234     │                 │             │
│      │─────────────────────────▶│                 │             │
│      │                          │                 │             │
│      │                          │  HSET heartbeat │             │
│      │                          │────────────────▶│             │
│      │                          │                 │             │
│      │                          │  Update in-memory│            │
│      │                          │  HeartbeatStatus │            │
│      │                          │                 │             │
│      │        OK                │                 │             │
│      │◀─────────────────────────│                 │             │
│                                                                  │
│   [Every 10 seconds - Background Check]                         │
│                                                                  │
│   Monitor ──▶ Check last_heartbeat timestamp                     │
│               If elapsed > timeout:                              │
│                 - Increment consecutive_misses                   │
│                 - If misses >= 3: mark_unhealthy()               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Eviction Logic

```rust
async fn check_all_heartbeats(&self, registry: Arc<LockFreeNodeRegistry>) {
    let mut heartbeats = self.heartbeats.write().await;
    let mut to_evict = Vec::new();

    for (node_id, status) in heartbeats.iter_mut() {
        if status.is_stale(self.config.timeout) {
            status.record_miss();

            if status.consecutive_misses >= self.config.max_missed_heartbeats {
                to_evict.push(node_id.clone());
                status.is_healthy = false;
            }
        }
    }

    // Evict unhealthy providers
    for node_id in to_evict {
        heartbeats.remove(&node_id);
        registry.mark_unhealthy(&node_id);
    }
}
```

---

## 9. Architecture Diagrams

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PROXYHUBB SYSTEM                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐         ┌─────────────────┐         ┌──────────────┐      │
│  │   Consumer   │◀───────▶│  Edge Gateway   │◀───────▶│    Node      │      │
│  │  (Buyer)     │  HTTP   │    (Rust)       │ Yamux   │  (Provider)  │      │
│  │              │ CONNECT │                 │ Tunnel  │              │      │
│  └──────────────┘         └────────┬────────┘         └──────┬───────┘      │
│                                     │                        │              │
│                                     ▼                        ▼              │
│                              ┌──────────┐              ┌──────────┐        │
│                              │  Redis   │              │ Internet │        │
│                              │          │              │          │        │
│                              └────┬─────┘              └──────────┘        │
│                                   │                                         │
│                                   ▼                                         │
│                         ┌─────────────────┐                                 │
│                         │  Control API    │                                 │
│                         │    (Go/Gin)     │                                 │
│                         └────────┬────────┘                                 │
│                                  │                                          │
│                                  ▼                                          │
│                         ┌─────────────────┐                                 │
│                         │  PostgreSQL     │                                 │
│                         │  (Primary DB)   │                                 │
│                         └─────────────────┘                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Node Registry Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    NODE REGISTRY DATA FLOW                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐        ┌─────────────────────┐                 │
│  │   Tunnel    │───────▶│ LockFreeNodeRegistry│                 │
│  │   Server    │ insert │  (DashMap)          │                 │
│  └─────────────┘        └──────────┬──────────┘                 │
│                                    │                            │
│                   ┌────────────────┼────────────────┐           │
│                   │                │                │           │
│                   ▼                ▼                ▼           │
│            ┌──────────┐     ┌──────────┐    ┌──────────┐       │
│            │Top Nodes │     │Heartbeat │    │  Redis   │       │
│            │Snapshot  │     │ Monitor  │    │  Store   │       │
│            │(O(1) sel)│     │          │    │          │       │
│            └──────────┘     └──────────┘    └──────────┘       │
│                                                                  │
│  Consumer Request:                                               │
│  ┌──────────┐     get_best()     ┌──────────┐                   │
│  │  main.rs │───────────────────▶│ Registry │                   │
│  └──────────┘                    └──────────┘                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. Key Data Structures

### NodeInfo (Runtime)

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NodeInfo {
    pub node_id: String,
    pub user_id: Option<String>,
    pub country_code: String,      // ISO 3166-1 alpha-2
    pub region: String,            // City/region name
    pub ip_address: String,
    pub connected_at: u64,         // Unix timestamp
    pub total_bytes_served: u64,
    pub active_connections: u32,
    pub max_connections: u32,
    pub latency_ms: u32,
    pub bandwidth_rate_kbps: u32,
    pub is_healthy: bool,
    pub capabilities: ProviderCapabilities,
    pub assigned_limits: AssignedLimits,
    pub qos_tier: String,
}
```

### ProviderCapabilities

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    pub max_connections: u32,
    pub max_bandwidth_mbps: u32,
    pub available_ports: Vec<u16>,
    pub connection_type: String,   // "fiber", "cable", "dsl", "mobile", "satellite"
    pub uplink_speed_kbps: u32,
    pub downlink_speed_kbps: u32,
    pub cpu_cores: u32,
    pub memory_mb: u32,
    pub os: String,
    pub client_version: String,
    pub features: Vec<String>,     // "ipv6", "udp_relay", etc.
}
```

### AssignedLimits

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssignedLimits {
    pub max_connections: u32,
    pub bandwidth_cap_mbps: u32,
    pub allowed_ports: Vec<u16>,
    pub qos_tier: String,          // "premium", "standard", "basic", "limited"
    pub priority: u32,             // 0-100 routing priority
}
```

---

## Summary

The Node System in ProxyHubb is a sophisticated distributed architecture that:

1. **Enables decentralized proxy services** - Anyone with internet can become a provider
2. **Routes traffic intelligently** - ML-based and heuristic selection for optimal performance
3. **Monitors health continuously** - Heartbeat system ensures only healthy nodes serve traffic
4. **Scales horizontally** - Lock-free data structures support high concurrent connection counts
5. **Persists state reliably** - Redis backing ensures reputation and stats survive restarts

The system balances performance (lock-free registries, O(1) selection), reliability (circuit breakers, health monitoring), and fairness (scoring based on capability and performance).

---

*Report generated from analysis of:*
- `services/edge-gateway/src/state.rs`
- `services/edge-gateway/src/tunnel.rs`
- `services/edge-gateway/src/registry/lockfree.rs`
- `services/edge-gateway/src/heartbeat.rs`
- `services/edge-gateway/src/main.rs`
- `services/control-api/internal/models/node.go`
- `services/control-api/cmd/provider-cli/cmd/node.go`
