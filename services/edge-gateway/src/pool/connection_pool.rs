//! Per-node yamux stream connection pool.
//!
//! Amortises the cost of opening new yamux streams by keeping a bounded pool
//! of idle streams per provider node.  When a request arrives the pool tries
//! to hand out an existing idle stream; if the pool is empty a new stream is
//! opened from the node's `yamux::Control`.
//!
//! Phase 1 target: connection-establishment latency 5 ms → 1 ms (pooled).

use dashmap::DashMap;
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tracing::{debug, warn};

/// A single idle yamux stream together with the instant it was parked.
struct IdleStream {
    stream: yamux::Stream,
    parked_at: Instant,
}

/// Per-node pool of idle yamux streams.
struct PoolBucket {
    /// Queue of idle streams waiting to be reused.
    idle: Mutex<VecDeque<IdleStream>>,
    /// Number of streams currently checked out of this pool.
    in_use: AtomicUsize,
    /// Unix-millis of the last time a stream was acquired from this bucket.
    last_used: AtomicU64,
}

impl PoolBucket {
    fn new() -> Self {
        let now_ms = Instant::now().elapsed().as_millis() as u64; // relative; good enough for eviction
        Self {
            idle: Mutex::new(VecDeque::new()),
            in_use: AtomicUsize::new(0),
            last_used: AtomicU64::new(now_ms),
        }
    }

    /// Try to acquire an idle stream from this bucket.
    fn acquire(&self, idle_timeout: Duration) -> Option<yamux::Stream> {
        let mut queue = self.idle.lock().ok()?;
        // Drain streams that have been idle too long.
        while let Some(front) = queue.front() {
            if front.parked_at.elapsed() > idle_timeout {
                queue.pop_front();
            } else {
                break;
            }
        }
        if let Some(idle) = queue.pop_front() {
            self.in_use.fetch_add(1, Ordering::Relaxed);
            self.last_used.store(
                Instant::now().elapsed().as_millis() as u64,
                Ordering::Relaxed,
            );
            Some(idle.stream)
        } else {
            None
        }
    }

    /// Return a stream to the idle pool.
    fn release(&self, stream: yamux::Stream, max_idle: usize) {
        self.in_use.fetch_sub(1, Ordering::Relaxed);
        if let Ok(mut queue) = self.idle.lock() {
            if queue.len() < max_idle {
                queue.push_back(IdleStream {
                    stream,
                    parked_at: Instant::now(),
                });
            }
            // If pool is full the stream is simply dropped (closed).
        }
    }

    fn idle_count(&self) -> usize {
        self.idle.lock().map(|q| q.len()).unwrap_or(0)
    }

    fn in_use_count(&self) -> usize {
        self.in_use.load(Ordering::Relaxed)
    }
}

/// Pool-wide configuration.
#[derive(Clone, Debug)]
pub struct PoolConfig {
    /// Maximum idle streams to keep per node.
    pub max_idle_per_node: usize,
    /// How long an idle stream is kept before eviction.
    pub idle_timeout: Duration,
    /// Maximum stream lifetime (not yet enforced; reserved for Phase 2).
    pub max_lifetime: Duration,
}

impl Default for PoolConfig {
    fn default() -> Self {
        Self {
            max_idle_per_node: 10,
            idle_timeout: Duration::from_secs(60),
            max_lifetime: Duration::from_secs(300),
        }
    }
}

/// A guard returned by `ConnectionPool::acquire`.
///
/// When dropped the inner stream is automatically returned to the pool.
pub struct PooledStream {
    stream: Option<yamux::Stream>,
    node_id: String,
    pool: Arc<ConnectionPool>,
}

impl PooledStream {
    /// Get a mutable reference to the inner yamux stream.
    pub fn stream_mut(&mut self) -> &mut yamux::Stream {
        self.stream.as_mut().expect("stream already consumed")
    }

    /// Consume the guard and explicitly discard the stream (do not return to pool).
    pub fn discard(mut self) {
        self.stream.take(); // drop stream, skip return-to-pool logic
    }

    /// Take ownership of the inner yamux stream without returning it to the pool.
    ///
    /// Use when the caller needs to consume the stream (e.g., for a tunnel that
    /// closes the stream on completion and cannot reuse it).
    pub fn take_stream(mut self) -> yamux::Stream {
        self.stream.take().expect("stream already consumed")
        // self drops with stream == None → PooledStream::drop skips release
    }
}

impl Drop for PooledStream {
    fn drop(&mut self) {
        if let Some(stream) = self.stream.take() {
            if let Some(bucket) = self.pool.buckets.get(&self.node_id) {
                bucket.release(stream, self.pool.config.max_idle_per_node);
            }
        }
    }
}

/// Multi-node yamux stream pool.
pub struct ConnectionPool {
    buckets: DashMap<String, Arc<PoolBucket>>,
    config: PoolConfig,
}

impl ConnectionPool {
    pub fn new(config: PoolConfig) -> Arc<Self> {
        Arc::new(Self {
            buckets: DashMap::new(),
            config,
        })
    }

    /// Acquire a stream for `node_id`.
    ///
    /// Returns `Some(PooledStream)` if an idle stream is available, or `None`
    /// if the pool is empty (caller should open a new stream via yamux Control).
    pub fn acquire(self: &Arc<Self>, node_id: &str) -> Option<PooledStream> {
        let bucket = self
            .buckets
            .entry(node_id.to_string())
            .or_insert_with(|| Arc::new(PoolBucket::new()))
            .clone();

        let stream = bucket.acquire(self.config.idle_timeout)?;
        debug!("Pool hit for node {}", node_id);
        Some(PooledStream {
            stream: Some(stream),
            node_id: node_id.to_string(),
            pool: Arc::clone(self),
        })
    }

    /// Return a stream to the pool after successful use.
    ///
    /// Typically called via `PooledStream::drop`, but can be invoked explicitly.
    pub fn release(self: &Arc<Self>, node_id: &str, stream: yamux::Stream) {
        let bucket = self
            .buckets
            .entry(node_id.to_string())
            .or_insert_with(|| Arc::new(PoolBucket::new()))
            .clone();
        bucket.release(stream, self.config.max_idle_per_node);
    }

    /// Remove all pool state for a node (called when a provider disconnects).
    pub fn evict_node(&self, node_id: &str) {
        if self.buckets.remove(node_id).is_some() {
            debug!("Evicted pool bucket for node {}", node_id);
        }
    }

    /// Prune idle streams that have exceeded `idle_timeout` across all nodes.
    /// Call this periodically (e.g., every 30 s) from a background task.
    pub fn prune_idle(&self) {
        let timeout = self.config.idle_timeout;
        for entry in self.buckets.iter() {
            let bucket = entry.value();
            if let Ok(mut queue) = bucket.idle.lock() {
                let before = queue.len();
                queue.retain(|s| s.parked_at.elapsed() <= timeout);
                let pruned = before - queue.len();
                if pruned > 0 {
                    debug!(
                        "Pruned {} stale streams from pool for node {}",
                        pruned,
                        entry.key()
                    );
                }
            }
        }
    }

    /// Return the number of idle streams currently cached for `node_id`.
    pub fn idle_count(&self, node_id: &str) -> usize {
        self.buckets
            .get(node_id)
            .map(|b| b.idle_count())
            .unwrap_or(0)
    }

    /// Aggregate pool statistics for metrics.
    pub fn stats(&self) -> PoolStats {
        let mut total_idle = 0;
        let mut total_in_use = 0;
        for entry in self.buckets.iter() {
            total_idle += entry.value().idle_count();
            total_in_use += entry.value().in_use_count();
        }
        PoolStats {
            nodes: self.buckets.len(),
            total_idle,
            total_in_use,
        }
    }
}

/// Snapshot of pool utilisation for Prometheus metrics.
#[derive(Debug, Clone)]
pub struct PoolStats {
    pub nodes: usize,
    pub total_idle: usize,
    pub total_in_use: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pool_stats_empty() {
        let pool = ConnectionPool::new(PoolConfig::default());
        let stats = pool.stats();
        assert_eq!(stats.nodes, 0);
        assert_eq!(stats.total_idle, 0);
        assert_eq!(stats.total_in_use, 0);
    }

    #[test]
    fn test_acquire_returns_none_when_empty() {
        let pool = ConnectionPool::new(PoolConfig::default());
        assert!(pool.acquire("node-1").is_none());
    }

    #[test]
    fn test_evict_nonexistent_is_safe() {
        let pool = ConnectionPool::new(PoolConfig::default());
        pool.evict_node("ghost"); // must not panic
    }

    #[test]
    fn test_prune_idle_on_empty_pool() {
        let pool = ConnectionPool::new(PoolConfig::default());
        pool.prune_idle(); // must not panic
    }
}
