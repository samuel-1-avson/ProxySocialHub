# Proxy Gateway - Detailed Action Plan

> **Date**: March 14, 2026  
> **Status**: Implementation-Ready  
> **Priority**: P0 (Critical) → P3 (Strategic)

---

## 10.1 Immediate Actions (This Week)

### P0-A1: Remove Remaining Mutex Usage in Legacy Paths

**Problem**: The `std::sync::Mutex` on `NodeRegistry` creates a global contention point that serializes all connection routing.

**Implementation**:

```rust
// File: services/edge-gateway/src/state.rs
// BEFORE: Legacy code still uses Mutex
use std::sync::Mutex;
pub struct OldAppState {
    pub registry: Arc<Mutex<NodeRegistry>>, // ❌ Remove this
}

// AFTER: Already migrated to LockFreeNodeRegistry
use dashmap::DashMap;
pub struct AppState {
    pub registry: Arc<LockFreeNodeRegistry>, // ✅ Already implemented
}

// Checklist:
// [ ] Search for all Mutex<NodeRegistry> usages
// [ ] Replace with LockFreeNodeRegistry
// [ ] Update all call sites
// [ ] Run benchmarks to verify improvement
```

**Files to Modify**:
- `services/edge-gateway/src/state.rs` - Remove legacy registry code
- `services/edge-gateway/src/main.rs` - Ensure only lock-free paths used
- `services/edge-gateway/src/tunnel.rs` - Update registration calls

**Verification**:
```bash
cd services/edge-gateway
cargo test --release
cargo bench
```

**Expected Impact**: 10-50x improvement in concurrent connection handling

---

### P0-A2: Cap Session Cache Size (LRU with Max Entries)

**Problem**: The LRU cache for sessions grows indefinitely, causing memory exhaustion at scale.

**Implementation**:

```rust
// File: services/edge-gateway/src/auth.rs
use lru::LruCache;
use std::num::NonZeroUsize;

pub struct SessionAuthenticator {
    // BEFORE: Unbounded HashMap
    // cache: Arc<Mutex<HashMap<String, CachedSession>>>,
    
    // AFTER: Bounded LRU Cache (100K entries max)
    cache: Arc<Mutex<LruCache<String, CachedSession>>>,
    max_entries: NonZeroUsize,
}

impl SessionAuthenticator {
    pub async fn new(redis_url: &str) -> Result<Self, redis::RedisError> {
        let max_entries = NonZeroUsize::new(100_000).expect("100K is non-zero");
        
        Ok(Self {
            redis_client: redis::Client::open(redis_url)?,
            cache: Arc::new(Mutex::new(LruCache::new(max_entries))),
            max_entries,
        })
    }
    
    pub async fn validate_session(&self, session_id: &str, refresh: bool) -> Result<Option<SessionData>, AuthError> {
        // Check LRU cache first
        {
            let mut cache = self.cache.lock().await;
            if let Some(cached) = cache.get(session_id) {
                if !refresh && cached.expires_at > Instant::now() {
                    return Ok(Some(cached.data.clone()));
                }
            }
            // If full, LRU automatically evicts oldest
        }
        
        // Fall through to Redis...
    }
}
```

**Configuration**:
```rust
// Add to services/edge-gateway/src/config.rs
pub struct Config {
    // ... existing fields ...
    pub session_cache_size: usize,
    pub session_cache_ttl_secs: u64,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            // ... existing ...
            session_cache_size: env::var("SESSION_CACHE_SIZE")
                .unwrap_or_else(|_| "100000".to_string())
                .parse()
                .expect("SESSION_CACHE_SIZE must be a number"),
            session_cache_ttl_secs: env::var("SESSION_CACHE_TTL_SECS")
                .unwrap_or_else(|_| "300".to_string())
                .parse()
                .expect("SESSION_CACHE_TTL_SECS must be a number"),
        }
    }
}
```

**Environment Variables**:
```bash
# .env
SESSION_CACHE_SIZE=100000
SESSION_CACHE_TTL_SECS=300
```

**Monitoring**:
```rust
// Add metrics for cache performance
metrics::SESSION_CACHE_HITS.inc();
metrics::SESSION_CACHE_MISSES.inc();
metrics::SESSION_CACHE_EVICTIONS.inc();
```

---

### P1-A3: Reduce Prometheus Label Cardinality

**Problem**: High-cardinality labels (`user_id`, `node_id`) create millions of time series, causing Prometheus to OOM.

**Implementation**:

```rust
// File: services/edge-gateway/src/metrics.rs

// BEFORE: High cardinality
lazy_static! {
    pub static ref RATE_LIMIT_HITS: CounterVec = register_counter_vec!(
        "edge_gateway_rate_limit_hits",
        "Rate limit hits per user",
        &["user_id"]  // ❌ Millions of users = millions of series
    ).unwrap();
}

// AFTER: Bucketed labels
lazy_static! {
    // Bucket users by tier instead of individual ID
    pub static ref RATE_LIMIT_HITS: CounterVec = register_counter_vec!(
        "edge_gateway_rate_limit_hits",
        "Rate limit hits by tier",
        &["tier"]  // ✅ 5 tiers = 5 series
    ).unwrap();
    
    // For node metrics, aggregate by region/country
    pub static ref PROVIDER_LATENCY: GaugeVec = register_gauge_vec!(
        "edge_gateway_provider_latency_ms",
        "Average provider latency by region",
        &["region", "country_code"]  // ✅ Aggregated, not per-node
    ).unwrap();
}

// Usage
pub fn record_rate_limit_hit(user_id: &str, tier: &str) {
    // Use tier label instead of user_id
    RATE_LIMIT_HITS.with_label_values(&[tier]).inc();
    
    // Log user_id separately for debugging (not in metrics)
    tracing::info!(user_id, tier, "Rate limit hit");
}
```

**Alternative: Separate Analytics System**:
```rust
// For high-cardinality data, use separate analytics pipeline
pub async fn record_high_cardinality_event(user_id: &str, event: &str) {
    // Send to NATS/Redis for async processing
    let event = AnalyticsEvent {
        user_id: user_id.to_string(),
        event: event.to_string(),
        timestamp: Utc::now(),
    };
    
    // Fire and forget to analytics pipeline
    let _ = nats::publish("analytics.events", event).await;
}
```

**Cardinality Limits**:
```yaml
# prometheus.yml
global:
  scrape_interval: 15s

# Set cardinality limits per metric
metric_relabel_configs:
  - source_labels: [__name__]
    regex: 'edge_gateway_rate_limit_hits'
    target_label: __tmp_drop
    replacement: drop_if_cardinality_exceeds_1000
```

---

### P1-A4: Implement Connection Pooling for Redis

**Problem**: Creating new Redis connections per operation causes high overhead under load.

**Implementation**:

```rust
// File: services/edge-gateway/src/redis_pool.rs
use deadpool_redis::{Config, Pool, Runtime};

pub struct RedisPool {
    pool: Pool,
}

impl RedisPool {
    pub fn new(redis_url: &str, max_size: usize) -> Result<Self, Box<dyn std::error::Error>> {
        let cfg = Config::from_url(redis_url);
        let pool = cfg.builder()?
            .max_size(max_size)
            .runtime(Runtime::Tokio1)
            .build()?;
        
        Ok(Self { pool })
    }
    
    pub async fn get(&self) -> Result<deadpool_redis::Connection, PoolError> {
        self.pool.get().await
    }
}

// File: services/edge-gateway/src/auth.rs
pub struct SessionAuthenticator {
    redis_pool: RedisPool,  // ✅ Use pool instead of creating connections
}

impl SessionAuthenticator {
    pub async fn validate_session(&self, session_id: &str) -> Result<Option<SessionData>, AuthError> {
        let mut conn = self.redis_pool.get().await?;  // ✅ Reuse connection
        let data: Option<String> = redis::cmd("GET")
            .arg(format!("session:{}", session_id))
            .query_async(&mut conn)
            .await?;
        // ...
    }
}
```

**Dependencies**:
```toml
# Cargo.toml
[dependencies]
deadpool-redis = "0.15"
```

**Pool Configuration**:
```rust
// Config values
pub struct Config {
    pub redis_pool_size: usize,
    pub redis_pool_timeout_ms: u64,
}

// Default: 32 connections
const DEFAULT_REDIS_POOL_SIZE: usize = 32;
```

---

## 10.2 Short-Term Actions (This Month)

### P1-A5: Integrate SDK Examples into Dashboard API

**Implementation**:

```typescript
// File: apps/web/src/lib/api/sdks.ts
export interface SDKExample {
    language: 'python' | 'nodejs' | 'golang' | 'curl';
    title: string;
    code: string;
    description: string;
}

export async function getSDKExamples(language: string, sessionId?: string): Promise<SDKExample[]> {
    const response = await fetch(`/api/v1/sdks/${language}/examples?session_id=${sessionId || ''}`);
    return response.json();
}

export async function generateProxyCode(language: string, credentials: ProxyCredentials): Promise<string> {
    const response = await fetch('/api/v1/sdks/generate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, credentials }),
    });
    return response.text();
}
```

```go
// File: services/control-api/internal/api/sdks.go
package api

import (
    "github.com/gin-gonic/gin"
    "text/template"
)

type SDKExample struct {
    Language    string `json:"language"`
    Title       string `json:"title"`
    Code        string `json:"code"`
    Description string `json:"description"`
}

// RegisterSDKRoutes registers SDK-related routes
func RegisterSDKRoutes(rg *gin.RouterGroup) {
    rg.GET("/sdks/:language/examples", getSDKExamples)
    rg.POST("/sdks/generate-code", generateProxyCode)
}

func getSDKExamples(c *gin.Context) {
    language := c.Param("language")
    sessionID := c.Query("session_id")
    
    examples := []SDKExample{
        {
            Language:    language,
            Title:       "Basic HTTP Request",
            Description: "Simple request through ProxyHub",
            Code:        generateBasicExample(language, sessionID),
        },
        {
            Language:    language,
            Title:       "Rotating Session",
            Description: "Use rotating IP addresses",
            Code:        generateRotatingExample(language, sessionID),
        },
        {
            Language:    language,
            Title:       "Sticky Session",
            Description: "Maintain same IP for session",
            Code:        generateStickyExample(language, sessionID),
        },
    }
    
    c.JSON(200, examples)
}

func generateBasicExample(language, sessionID string) string {
    templates := map[string]string{
        "python": `import requests

proxy = {
    "http": "http://{{.Username}}:{{.Password}}@proxy.proxyhub.io:3128",
    "https": "http://{{.Username}}:{{.Password}}@proxy.proxyhub.io:3128"
}

response = requests.get("https://httpbin.org/ip", proxies=proxy)
print(response.json())`,
        "nodejs": `const axios = require('axios');

const proxy = {
    host: 'proxy.proxyhub.io',
    port: 3128,
    auth: {
        username: '{{.Username}}',
        password: '{{.Password}}'
    }
};

axios.get('https://httpbin.org/ip', { proxy })
    .then(res => console.log(res.data))
    .catch(err => console.error(err));`,
        "golang": `package main

import (
    "net/http"
    "net/url"
)

func main() {
    proxyURL, _ := url.Parse("http://{{.Username}}:{{.Password}}@proxy.proxyhub.io:3128")
    
    client := &http.Client{
        Transport: &http.Transport{
            Proxy: http.ProxyURL(proxyURL),
        },
    }
    
    resp, _ := client.Get("https://httpbin.org/ip")
    // ...
}`,
        "curl": `curl -x http://{{.Username}}:{{.Password}}@proxy.proxyhub.io:3128 \
  https://httpbin.org/ip`,
    }
    
    tmpl, _ := template.New("example").Parse(templates[language])
    var buf strings.Builder
    tmpl.Execute(&buf, map[string]string{
        "Username": sessionID,
        "Password": "********",
    })
    return buf.String()
}
```

**Frontend Integration**:
```tsx
// File: apps/web/src/components/SDKExampleCard.tsx
"use client";

import { useState } from 'react';
import { getSDKExamples } from '@/lib/api/sdks';
import { Copy, CheckCircle } from 'lucide-react';

export function SDKExampleCard({ language, sessionId }: { language: string; sessionId?: string }) {
    const [examples, setExamples] = useState<SDKExample[]>([]);
    const [copied, setCopied] = useState<string | null>(null);
    
    useEffect(() => {
        getSDKExamples(language, sessionId).then(setExamples);
    }, [language, sessionId]);
    
    const copyToClipboard = (code: string, id: string) => {
        navigator.clipboard.writeText(code);
        setCopied(id);
        setTimeout(() => setCopied(null), 3000);
    };
    
    return (
        <div className="space-y-4">
            {examples.map((example) => (
                <div key={example.title} className="glass-card p-4 border-white/5">
                    <div className="flex justify-between items-center mb-2">
                        <h4 className="text-sm font-bold">{example.title}</h4>
                        <button
                            onClick={() => copyToClipboard(example.code, example.title)}
                            className="text-xs flex items-center gap-1"
                        >
                            {copied === example.title ? (
                                <><CheckCircle size={14} className="text-emerald-500" /> Copied</>
                            ) : (
                                <><Copy size={14} /> Copy</>
                            )}
                        </button>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">{example.description}</p>
                    <pre className="bg-black/50 p-3 rounded-lg text-xs overflow-x-auto">
                        <code>{example.code}</code>
                    </pre>
                </div>
            ))}
        </div>
    );
}
```

---

### P1-A6: Add Provider Capacity Negotiation

**Implementation**:

```rust
// File: services/edge-gateway/src/tunnel.rs

// Enhanced provider handshake
pub async fn handle_provider_auth(
    stream: &mut yamux::Stream,
    state: Arc<AppState>,
) -> Result<ProviderSession, TunnelError> {
    // 1. AUTH <JWT>
    let jwt = read_auth_token(stream).await?;
    let claims = validate_jwt(&jwt)?;
    
    // 2. Send OK
    write_response(stream, "OK").await?;
    
    // 3. CAPABILITY <JSON> (NEW)
    let caps = read_capability_declaration(stream).await?;
    
    // 4. ACK with assigned limits
    let assigned = calculate_assigned_limits(&caps);
    write_response(stream, format!("ACK {}", serde_json::to_string(&assigned)?)).await?;
    
    Ok(ProviderSession {
        node_id: claims.node_id,
        user_id: claims.user_id,
        capabilities: caps,
        assigned_limits: assigned,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    pub max_connections: u32,
    pub max_bandwidth_mbps: u32,
    pub available_ports: Vec<u16>,
    pub connection_type: String, // "fiber", "cable", "dsl", "mobile"
    pub uplink_speed_kbps: u32,
    pub downlink_speed_kbps: u32,
    pub cpu_cores: u32,
    pub memory_mb: u32,
    pub os: String,
    pub client_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssignedLimits {
    pub max_connections: u32,
    pub bandwidth_cap_mbps: u32,
    pub allowed_ports: Vec<u16>,
    pub qos_tier: String, // "premium", "standard", "basic"
}

fn calculate_assigned_limits(caps: &ProviderCapabilities) -> AssignedLimits {
    // Right-size based on declared capabilities
    let max_conns = if caps.cpu_cores >= 4 && caps.memory_mb >= 8192 {
        caps.max_connections.min(200)  // High-end machine
    } else if caps.cpu_cores >= 2 && caps.memory_mb >= 4096 {
        caps.max_connections.min(100)  // Mid-range
    } else {
        caps.max_connections.min(50)   // Low-end / Raspberry Pi
    };
    
    let bw_cap = caps.downlink_speed_kbps.min(100_000) / 1000; // Cap at 100 Mbps
    
    let qos_tier = if caps.connection_type == "fiber" && caps.downlink_speed_kbps >= 50_000 {
        "premium"
    } else if caps.connection_type == "cable" || caps.connection_type == "fiber" {
        "standard"
    } else {
        "basic"
    };
    
    AssignedLimits {
        max_connections: max_conns,
        bandwidth_cap_mbps: bw_cap,
        allowed_ports: caps.available_ports.clone(),
        qos_tier: qos_tier.to_string(),
    }
}
```

**NodeInfo Update**:
```rust
// File: services/edge-gateway/src/state.rs
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NodeInfo {
    // ... existing fields ...
    pub capabilities: ProviderCapabilities,
    pub assigned_limits: AssignedLimits,
    pub qos_tier: String,
}

impl NodeInfo {
    pub fn score(&self) -> u32 {
        let mut score = 1000u32;
        
        // Factor in QoS tier
        score += match self.qos_tier.as_str() {
            "premium" => 200,
            "standard" => 100,
            _ => 0,
        };
        
        // Factor in bandwidth capacity
        let bw_score = self.capabilities.downlink_speed_kbps / 1000; // MB/s
        score += bw_score.min(100);
        
        // ... rest of scoring ...
        score
    }
}
```

---

### P2-A7: Implement Domain Blocklist

**Implementation**:

```rust
// File: services/edge-gateway/src/policy.rs

use std::collections::HashSet;

pub struct DomainPolicy {
    blocked_domains: HashSet<String>,
    allowed_domains: HashSet<String>, // If non-empty, only these are allowed
}

impl DomainPolicy {
    pub fn new() -> Self {
        Self {
            blocked_domains: Self::load_blocked_domains(),
            allowed_domains: Self::load_allowed_domains(),
        }
    }
    
    pub fn is_domain_allowed(&self, domain: &str) -> Result<(), String> {
        // Check blocklist first
        for blocked in &self.blocked_domains {
            if domain == blocked || domain.ends_with(&format!(".{}", blocked)) {
                return Err(format!("Domain '{}' is blocked", domain));
            }
        }
        
        // Check allowlist if configured
        if !self.allowed_domains.is_empty() {
            let mut allowed = false;
            for allowed_domain in &self.allowed_domains {
                if domain == allowed_domain || domain.ends_with(&format!(".{}", allowed_domain)) {
                    allowed = true;
                    break;
                }
            }
            if !allowed {
                return Err(format!("Domain '{}' not in allowlist", domain));
            }
        }
        
        Ok(())
    }
    
    fn load_blocked_domains() -> HashSet<String> {
        // Load from Redis/config
        vec![
            "government.gh",      // Example: Ghana government sites
            "*.gov",              // All government domains
            "*.mil",              // Military domains
            "localhost",
            "127.0.0.1",
            "169.254.169.254",    // AWS metadata
        ]
        .into_iter()
        .map(|s| s.to_lowercase())
        .collect()
    }
}

// Usage in main.rs
async fn proxy(req: Request<hyper::body::Incoming>, state: Arc<AppState>) -> Result<Response<Full<Bytes>>, hyper::Error> {
    let addr = host_addr(req.uri()).unwrap_or_default();
    let host = addr.split(':').next().unwrap_or(&addr);
    
    // Check domain policy
    if let Err(reason) = state.domain_policy.is_domain_allowed(host) {
        warn!("Domain policy violation: {}", reason);
        metrics::record_policy_block("blocked_domain");
        return Ok(Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(Full::new(Bytes::from(reason)))
            .unwrap());
    }
    
    // ... continue processing ...
}
```

**Redis-Backed Dynamic Blocklist**:
```rust
// Load from Redis for hot updates
pub async fn reload_blocklist(&mut self, redis: &mut redis::aio::Connection) -> Result<(), redis::RedisError> {
    let blocked: Vec<String> = redis.smembers("proxy:blocklist:domains").await?;
    self.blocked_domains = blocked.into_iter().map(|s| s.to_lowercase()).collect();
    
    info!("Reloaded blocklist: {} domains blocked", self.blocked_domains.len());
    Ok(())
}
```

---

### P2-A8: Add DNS Rebinding Protection

**Implementation**:

```rust
// File: services/edge-gateway/src/policy.rs

use std::net::IpAddr;

pub fn validate_destination_post_dns(host: &str, resolved_ip: IpAddr) -> Result<(), String> {
    // After DNS resolution, re-validate the IP
    
    // Block private IPs
    if is_private_ip(resolved_ip) {
        return Err(format!("DNS rebinding detected: {} resolves to private IP {}", host, resolved_ip));
    }
    
    // Block cloud metadata endpoints
    if is_cloud_metadata_ip(resolved_ip) {
        return Err(format!("Cloud metadata access blocked: {}", resolved_ip));
    }
    
    Ok(())
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => {
            ipv4.is_private() ||
            ipv4.is_loopback() ||
            ipv4.is_link_local() ||
            ipv4.is_multicast()
        }
        IpAddr::V6(ipv6) => {
            ipv6.is_loopback() ||
            ipv6.is_multicast()
        }
    }
}

fn is_cloud_metadata_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => {
            // AWS metadata
            ipv4.to_string().starts_with("169.254.169.254") ||
            // GCP metadata
            ipv4.to_string().starts_with("169.254.170.2")
        }
        _ => false,
    }
}
```

---

## 10.3 Long-Term Actions (Next Quarter)

### P2-A9: Direct gRPC Streaming to Blockchain

**Architecture**:
```rust
// File: services/edge-gateway/src/blockchain/grpc_stream.rs

use tonic::{transport::Channel, Request};
use solana_program_client::{UsageStreamClient, UsageEvent};

pub struct BlockchainStream {
    client: UsageStreamClient<Channel>,
    batch_size: usize,
    flush_interval: Duration,
}

impl BlockchainStream {
    pub async fn connect(endpoint: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let channel = Channel::from_shared(endpoint.to_string())?
            .connect()
            .await?;
        
        let client = UsageStreamClient::new(channel);
        
        Ok(Self {
            client,
            batch_size: 100,
            flush_interval: Duration::from_secs(5),
        })
    }
    
    pub async fn stream_usage(&mut self, events: Vec<UsageEvent>) -> Result<(), Box<dyn std::error::Error>> {
        let request = Request::new(tokio_stream::iter(events));
        self.client.report_usage(request).await?;
        Ok(())
    }
}
```

---

### P3-A10: Multi-Region Anycast Deployment

**Terraform Configuration**:
```hcl
# infra/terraform/multi-region.tf

module "edge_gateway_us" {
  source = "./modules/edge-gateway"
  
  region = "us-east-1"
  instance_count = 3
  
  redis_cluster_endpoint = aws_elasticache_replication_group.main.primary_endpoint_address
  solana_rpc_endpoints = ["https://api.mainnet-beta.solana.com"]
}

module "edge_gateway_eu" {
  source = "./modules/edge-gateway"
  
  region = "eu-west-1"
  instance_count = 3
  
  redis_cluster_endpoint = aws_elasticache_replication_group.main.primary_endpoint_address
  solana_rpc_endpoints = ["https://api.mainnet-beta.solana.com"]
}

# Anycast IP (AWS Global Accelerator)
resource "aws_globalaccelerator_accelerator" "main" {
  name = "proxyhub-edge"
  
  ip_address_type = "IPV4"
  enabled = true
}
```

---

## 10.4 Integration Matrices Enhancement - Detailed Phases

### Phase 1: SDK Code Example API (Week 1-2)

**API Endpoints**:
```yaml
openapi: 3.0.0
paths:
  /v1/sdks/{language}/examples:
    get:
      summary: Get SDK code examples
      parameters:
        - name: language
          in: path
          required: true
          schema:
            type: string
            enum: [python, nodejs, golang, curl]
      responses:
        200:
          description: List of code examples
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/SDKExample'

  /v1/sdks/generate-code:
    post:
      summary: Generate custom proxy code
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                language:
                  type: string
                session_id:
                  type: string
                use_case:
                  type: string
                  enum: [basic, rotating, sticky, scraping]
      responses:
        200:
          description: Generated code
          content:
            text/plain:
              schema:
                type: string
```

### Phase 2: Interactive Code Generator (Week 3-4)

**Features**:
- Syntax highlighting
- One-click copy
- Download as file
- Open in GitHub Codespaces
- Test directly in browser (for curl)

### Phase 3: SDK Authentication Helpers (Week 5-6)

**Python SDK**:
```python
# sdks/python/proxyhub/auth.py
from dataclasses import dataclass
import requests

@dataclass
class ProxyHubAuth:
    api_key: str
    api_secret: str
    
    def get_proxy_config(self) -> dict:
        """Get proxy configuration for requests library"""
        return {
            'http': f'http://{self.api_key}:{self.api_secret}@proxy.proxyhub.io:3128',
            'https': f'http://{self.api_key}:{self.api_secret}@proxy.proxyhub.io:3128',
        }
    
    def create_session(self, session_type: str = 'rotating'):
        """Create a requests session with ProxyHub configuration"""
        session = requests.Session()
        session.proxies = self.get_proxy_config()
        return session
```

### Phase 4: SDK Version Management (Week 7-8)

**Version Check API**:
```go
// services/control-api/internal/api/sdk_versions.go
func checkSDKVersion(c *gin.Context) {
    language := c.Param("language")
    currentVersion := c.Query("version")
    
    latest := getLatestVersion(language)
    
    c.JSON(200, gin.H{
        "current": currentVersion,
        "latest": latest.Version,
        "update_available": currentVersion != latest.Version,
        "download_url": latest.DownloadURL,
        "release_notes": latest.ReleaseNotes,
    })
}
```

---

## 10.5 Blockchain Connectivity Enhancement - Detailed Phases

### Phase 1: Direct gRPC (Week 1-4)

**Implementation**:
```rust
// Reduce latency by bypassing Control API for settlements
pub async fn stream_settlement_direct(
    &self,
    events: Vec<SettlementEvent>,
) -> Result<(), BlockchainError> {
    let mut client = self.solana_grpc_client.lock().await;
    
    let request = SettlementRequest {
        oracle_signature: self.sign_events(&events)?,
        events,
    };
    
    let response = client.submit_settlement(request).await?;
    
    if response.confirmations > 0 {
        Ok(())
    } else {
        Err(BlockchainError::NotConfirmed)
    }
}
```

### Phase 2: Real-Time Usage Streaming (Week 5-8)

**WebSocket for Live Billing**:
```typescript
// Frontend real-time usage display
const ws = new WebSocket('wss://api.proxyhub.io/v1/usage/stream');

ws.onmessage = (event) => {
    const usage = JSON.parse(event.data);
    updateBillingDashboard(usage);
};
```

### Phase 3: On-Chain Reputation (Week 9-12)

**Move reputation to Solana**:
```rust
// Reputation as on-chain data
pub struct OnChainReputation {
    pub node_id: String,
    pub total_sessions: u64,
    pub successful_sessions: u64,
    pub average_latency: u32,
    pub staked_amount: u64,
    pub slash_count: u32,
}
```

### Phase 4: Program Optimization (Week 13-16)

- Compress account data
- Batch transactions
- Use lookup tables
- Optimize compute units

---

## Success Metrics

| Action | Metric | Target |
|--------|--------|--------|
| Mutex Removal | Concurrent connections | 50,000+ |
| Session Cache | Memory usage per 100K sessions | < 50MB |
| Prometheus Labels | Time series count | < 10,000 |
| Redis Pooling | Connection time | < 1ms |
| SDK Examples | API response time | < 100ms |
| Capacity Negotiation | Provider utilization | 70-85% |
| gRPC Blockchain | Settlement latency | < 500ms |
| Multi-Region | Failover time | < 30s |

---

*This action plan provides implementation-ready guidance for all recommendations in the main analysis report.*
