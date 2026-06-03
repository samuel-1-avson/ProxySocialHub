use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicI32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Thread-safe metrics collector for the provider node.
#[derive(Debug, Clone)]
pub struct Collector {
    inner: Arc<Inner>,
}

#[derive(Debug)]
struct Inner {
    active_connections: AtomicI32,
    total_connections: AtomicU64,
    bytes_up: AtomicU64,
    bytes_down: AtomicU64,
    start_time: Instant,
    rate_state: Mutex<RateState>,
    latency_ms: AtomicU64,
    connection_type: Mutex<String>,
}

#[derive(Debug)]
struct RateState {
    prev_bytes_up: u64,
    prev_bytes_down: u64,
    prev_time: Instant,
    cached_rate_up_kbps: u32,
    cached_rate_dn_kbps: u32,
    last_heartbeat: Instant,
}

/// Point-in-time statistics snapshot (JSON-serializable).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub active_connections: i32,
    pub total_connections: u64,
    pub bytes_up: u64,
    pub bytes_down: u64,
    pub rate_up_kbps: u32,
    pub rate_down_kbps: u32,
    pub uptime_seconds: u64,
    pub last_heartbeat_ago_ms: u64,
    pub latency_ms: u64,
    pub connection_type: String,
}

impl Collector {
    pub fn new() -> Self {
        let now = Instant::now();
        Self {
            inner: Arc::new(Inner {
                active_connections: AtomicI32::new(0),
                total_connections: AtomicU64::new(0),
                bytes_up: AtomicU64::new(0),
                bytes_down: AtomicU64::new(0),
                start_time: now,
                rate_state: Mutex::new(RateState {
                    prev_bytes_up: 0,
                    prev_bytes_down: 0,
                    prev_time: now,
                    cached_rate_up_kbps: 0,
                    cached_rate_dn_kbps: 0,
                    last_heartbeat: now,
                }),
                latency_ms: AtomicU64::new(0),
                connection_type: Mutex::new("Unknown".to_string()),
            }),
        }
    }

    pub fn record_connection_opened(&self) {
        self.inner
            .active_connections
            .fetch_add(1, Ordering::Relaxed);
        self.inner.total_connections.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_connection_closed(&self) {
        self.inner
            .active_connections
            .fetch_sub(1, Ordering::Relaxed);
    }

    pub fn record_bytes_up(&self, n: u64) {
        self.inner.bytes_up.fetch_add(n, Ordering::Relaxed);
    }

    pub fn record_bytes_down(&self, n: u64) {
        self.inner.bytes_down.fetch_add(n, Ordering::Relaxed);
    }

    pub fn active_connections(&self) -> i32 {
        self.inner.active_connections.load(Ordering::Relaxed)
    }

    pub fn bytes_up(&self) -> u64 {
        self.inner.bytes_up.load(Ordering::Relaxed)
    }

    pub fn bytes_down(&self) -> u64 {
        self.inner.bytes_down.load(Ordering::Relaxed)
    }

    pub fn uptime(&self) -> Duration {
        self.inner.start_time.elapsed()
    }

    pub fn update_heartbeat(&self) {
        let mut state = self.inner.rate_state.lock().unwrap();
        state.last_heartbeat = Instant::now();
    }

    pub fn update_latency(&self, ms: u64) {
        self.inner.latency_ms.store(ms, Ordering::Relaxed);
    }

    pub fn set_connection_type(&self, t: String) {
        let mut state = self.inner.connection_type.lock().unwrap();
        *state = t;
    }

    /// Compute current bandwidth rates in Kbps.
    pub fn compute_rate(&self) -> (u32, u32) {
        let mut state = self.inner.rate_state.lock().unwrap();
        let now = Instant::now();
        let elapsed = now.duration_since(state.prev_time).as_secs_f64();

        if elapsed < 0.5 {
            return (state.cached_rate_up_kbps, state.cached_rate_dn_kbps);
        }

        let cur_up = self.inner.bytes_up.load(Ordering::Relaxed);
        let cur_down = self.inner.bytes_down.load(Ordering::Relaxed);

        // 125 bytes/s == 1 Kbps
        state.cached_rate_up_kbps =
            ((cur_up.saturating_sub(state.prev_bytes_up)) as f64 / elapsed / 125.0) as u32;
        state.cached_rate_dn_kbps =
            ((cur_down.saturating_sub(state.prev_bytes_down)) as f64 / elapsed / 125.0) as u32;

        state.prev_bytes_up = cur_up;
        state.prev_bytes_down = cur_down;
        state.prev_time = now;

        (state.cached_rate_up_kbps, state.cached_rate_dn_kbps)
    }

    pub fn snapshot(&self) -> Snapshot {
        let (rate_up, rate_down) = self.compute_rate();
        let last_hb_ago = {
            let state = self.inner.rate_state.lock().unwrap();
            state.last_heartbeat.elapsed().as_millis() as u64
        };
        Snapshot {
            active_connections: self.active_connections(),
            total_connections: self.inner.total_connections.load(Ordering::Relaxed),
            bytes_up: self.bytes_up(),
            bytes_down: self.bytes_down(),
            rate_up_kbps: rate_up,
            rate_down_kbps: rate_down,
            uptime_seconds: self.uptime().as_secs(),
            last_heartbeat_ago_ms: last_hb_ago,
            latency_ms: self.inner.latency_ms.load(Ordering::Relaxed),
            connection_type: self.inner.connection_type.lock().unwrap().clone(),
        }
    }
}

/// Start a minimal HTTP server that exposes `/stats` as JSON.
pub async fn serve_metrics(collector: Collector, port: u16) {
    let listener = match TcpListener::bind(format!("127.0.0.1:{port}")).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!("Failed to bind metrics server on port {port}: {e}");
            return;
        }
    };

    loop {
        let (mut stream, _) = match listener.accept().await {
            Ok(s) => s,
            Err(_) => continue,
        };

        let snap = collector.snapshot();
        let body = serde_json::to_string(&snap).unwrap_or_default();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );

        let _ = stream.write_all(response.as_bytes()).await;
        // Read (and discard) the request so the socket closes cleanly
        let mut buf = [0u8; 1024];
        let _ = stream.read(&mut buf).await;
    }
}
