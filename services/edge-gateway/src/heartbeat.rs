//! Provider heartbeat monitoring system
//!
//! Tracks provider health via periodic heartbeats and evicts unhealthy providers.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tokio::time::interval;
use tracing::{info, warn, error, debug};
use serde::{Deserialize, Serialize};
use redis::AsyncCommands;

/// Heartbeat status of a provider (in-memory tracking)
#[derive(Debug, Clone)]
pub struct HeartbeatStatus {
    pub node_id: String,
    pub last_heartbeat: Instant,
    pub consecutive_misses: u32,
    pub total_heartbeats: u64,
    pub is_healthy: bool,
    pub latency_ms: u32,
}

impl HeartbeatStatus {
    pub fn new(node_id: String) -> Self {
        Self {
            node_id,
            last_heartbeat: Instant::now(),
            consecutive_misses: 0,
            total_heartbeats: 0,
            is_healthy: true,
            latency_ms: 0,
        }
    }

    /// Record a successful heartbeat
    pub fn record_heartbeat(&mut self, latency_ms: u32) {
        self.last_heartbeat = Instant::now();
        self.consecutive_misses = 0;
        self.total_heartbeats += 1;
        self.latency_ms = latency_ms;
        self.is_healthy = true;
    }

    /// Mark as missed heartbeat
    pub fn record_miss(&mut self) {
        self.consecutive_misses += 1;
    }

    /// Check if heartbeat is stale (exceeded timeout)
    pub fn is_stale(&self, timeout: Duration) -> bool {
        self.last_heartbeat.elapsed() > timeout
    }
}

/// Redis-backed heartbeat store for distributed tracking
pub struct HeartbeatStore {
    redis_client: redis::Client,
}

impl HeartbeatStore {
    pub fn new(redis_client: redis::Client) -> Self {
        Self { redis_client }
    }

    /// Update heartbeat for a provider
    pub async fn update(&self, node_id: &str, timestamp: u64, status: Option<String>) {
        let mut conn = match self.redis_client.get_multiplexed_async_connection().await {
            Ok(conn) => conn,
            Err(e) => {
                error!("Failed to get Redis connection for heartbeat: {}", e);
                return;
            }
        };

        let key = format!("heartbeat:{}", node_id);
        let timestamp_str = timestamp.to_string();
        
        if let Err(e) = redis::cmd("HSET")
            .arg(&key)
            .arg("timestamp")
            .arg(&timestamp_str)
            .arg("status")
            .arg(status.as_deref().unwrap_or("{}"))
            .query_async::<_, ()>(&mut conn)
            .await
        {
            error!("Failed to update heartbeat for {}: {}", node_id, e);
            return;
        }

        // Set expiry on the heartbeat key (2 minutes)
        let _: Result<(), _> = conn.expire(&key, 120).await;
        
        debug!("Updated heartbeat for {} at {}", node_id, timestamp);
    }

    /// Check if a provider's heartbeat is still valid
    pub async fn is_alive(&self, node_id: &str, timeout_secs: u64) -> bool {
        let mut conn = match self.redis_client.get_multiplexed_async_connection().await {
            Ok(conn) => conn,
            Err(e) => {
                error!("Failed to get Redis connection: {}", e);
                return false;
            }
        };

        let key = format!("heartbeat:{}", node_id);
        
        match conn.exists(&key).await {
            Ok::<bool, _>(exists) => exists,
            Err(e) => {
                error!("Failed to check heartbeat for {}: {}", node_id, e);
                false
            }
        }
    }

    /// Get last heartbeat timestamp for a provider
    pub async fn get_last_heartbeat(&self, node_id: &str) -> Option<u64> {
        let mut conn = match self.redis_client.get_multiplexed_async_connection().await {
            Ok(conn) => conn,
            Err(e) => {
                error!("Failed to get Redis connection: {}", e);
                return None;
            }
        };

        let key = format!("heartbeat:{}", node_id);
        
        match conn.hget::<_, _, Option<String>>(&key, "timestamp").await {
            Ok(Some(ts)) => ts.parse().ok(),
            Ok(None) => None,
            Err(e) => {
                error!("Failed to get heartbeat for {}: {}", node_id, e);
                None
            }
        }
    }

    /// Remove heartbeat entry for a provider
    pub async fn remove(&self, node_id: &str) {
        let mut conn = match self.redis_client.get_multiplexed_async_connection().await {
            Ok(conn) => conn,
            Err(e) => {
                error!("Failed to get Redis connection: {}", e);
                return;
            }
        };

        let key = format!("heartbeat:{}", node_id);
        let _: Result<(), _> = conn.del(&key).await;
    }
}

/// Heartbeat monitor configuration
#[derive(Debug, Clone)]
pub struct HeartbeatConfig {
    /// Expected heartbeat interval from providers
    pub expected_interval: Duration,
    /// Timeout after which a provider is considered stale
    pub timeout: Duration,
    /// Number of missed heartbeats before eviction
    pub max_missed_heartbeats: u32,
    /// Check interval for the monitor
    pub check_interval: Duration,
}

impl Default for HeartbeatConfig {
    fn default() -> Self {
        Self {
            expected_interval: Duration::from_secs(30),
            timeout: Duration::from_secs(60),
            max_missed_heartbeats: 3,
            check_interval: Duration::from_secs(10),
        }
    }
}

/// Heartbeat monitor for tracking provider health
pub struct HeartbeatMonitor {
    heartbeats: Arc<RwLock<HashMap<String, HeartbeatStatus>>>,
    config: HeartbeatConfig,
}

impl HeartbeatMonitor {
    pub fn new(config: HeartbeatConfig) -> Self {
        Self {
            heartbeats: Arc::new(RwLock::new(HashMap::new())),
            config,
        }
    }

    /// Start the heartbeat monitoring task
    pub fn start_monitoring(self: Arc<Self>, registry: Arc<crate::registry::lockfree::LockFreeNodeRegistry>) {
        let check_interval = self.config.check_interval;

        tokio::spawn(async move {
            let mut ticker = interval(check_interval);

            loop {
                ticker.tick().await;

                if let Err(e) = self.check_all_heartbeats(registry.clone()).await {
                    error!("Heartbeat check error: {}", e);
                }
            }
        });

        info!("🔍 Heartbeat monitor started (check interval: {:?})", check_interval);
    }

    /// Register a new provider for heartbeat tracking
    pub async fn register_provider(&self, node_id: &str) {
        let mut heartbeats = self.heartbeats.write().await;
        heartbeats.insert(
            node_id.to_string(),
            HeartbeatStatus::new(node_id.to_string())
        );
        info!("💓 Registered provider {} for heartbeat monitoring", node_id);
    }

    /// Unregister a provider (when they disconnect)
    pub async fn unregister_provider(&self, node_id: &str) {
        let mut heartbeats = self.heartbeats.write().await;
        heartbeats.remove(node_id);
        debug!("Unregistered provider {} from heartbeat monitoring", node_id);
    }

    /// Record a heartbeat from a provider
    pub async fn record_heartbeat(&self, node_id: &str, latency_ms: u32) -> Result<(), String> {
        let mut heartbeats = self.heartbeats.write().await;
        
        match heartbeats.get_mut(node_id) {
            Some(status) => {
                status.record_heartbeat(latency_ms);
                debug!(
                    "💓 Heartbeat from {} (latency: {}ms, total: {})",
                    node_id, latency_ms, status.total_heartbeats
                );
                Ok(())
            }
            None => {
                // Auto-register if not exists (for backwards compatibility)
                let mut status = HeartbeatStatus::new(node_id.to_string());
                status.record_heartbeat(latency_ms);
                heartbeats.insert(node_id.to_string(), status);
                warn!("Auto-registered provider {} for heartbeat", node_id);
                Ok(())
            }
        }
    }

    /// Check all heartbeats and evict stale providers
    async fn check_all_heartbeats(
        &self,
        registry: Arc<crate::registry::lockfree::LockFreeNodeRegistry>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut heartbeats = self.heartbeats.write().await;
        let mut to_evict = Vec::new();

        for (node_id, status) in heartbeats.iter_mut() {
            if status.is_stale(self.config.timeout) {
                status.record_miss();

                warn!(
                    "⚠️ Provider {} heartbeat stale (missed: {}/{})",
                    node_id,
                    status.consecutive_misses,
                    self.config.max_missed_heartbeats
                );

                if status.consecutive_misses >= self.config.max_missed_heartbeats {
                    error!("🚫 Provider {} exceeded max missed heartbeats, evicting", node_id);
                    to_evict.push(node_id.clone());
                    status.is_healthy = false;
                }
            }
        }

        // Evict unhealthy providers — no lock needed with lock-free registry
        for node_id in to_evict {
            heartbeats.remove(&node_id);
            registry.mark_unhealthy(&node_id);
            info!("🚫 Evicted provider {} due to missed heartbeats", node_id);
        }

        Ok(())
    }

    /// Get health status of all providers
    pub async fn get_all_status(&self) -> Vec<HeartbeatStatus> {
        let heartbeats = self.heartbeats.read().await;
        heartbeats.values().cloned().collect()
    }

    /// Get health status of a specific provider
    pub async fn get_status(&self, node_id: &str) -> Option<HeartbeatStatus> {
        let heartbeats = self.heartbeats.read().await;
        heartbeats.get(node_id).cloned()
    }

    /// Check if provider is healthy
    pub async fn is_healthy(&self, node_id: &str) -> bool {
        match self.get_status(node_id).await {
            Some(status) => status.is_healthy && !status.is_stale(self.config.timeout),
            None => false,
        }
    }

    /// Get count of healthy providers
    pub async fn healthy_count(&self) -> usize {
        let heartbeats = self.heartbeats.read().await;
        heartbeats
            .values()
            .filter(|s| s.is_healthy && !s.is_stale(self.config.timeout))
            .count()
    }
}

/// Heartbeat message from provider
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

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::sleep;

    #[tokio::test]
    async fn test_heartbeat_status() {
        let mut status = HeartbeatStatus::new("node-1".to_string());
        
        assert!(status.is_healthy);
        assert_eq!(status.consecutive_misses, 0);
        
        // Record heartbeat
        status.record_heartbeat(50);
        assert_eq!(status.total_heartbeats, 1);
        assert_eq!(status.latency_ms, 50);
        
        // Record miss
        status.record_miss();
        assert_eq!(status.consecutive_misses, 1);
    }

    #[tokio::test]
    async fn test_heartbeat_monitor() {
        let config = HeartbeatConfig {
            expected_interval: Duration::from_secs(1),
            timeout: Duration::from_millis(100),
            max_missed_heartbeats: 2,
            check_interval: Duration::from_millis(50),
        };
        
        let monitor = Arc::new(HeartbeatMonitor::new(config));
        
        // Register provider
        monitor.register_provider("node-1").await;
        
        // Record heartbeat
        monitor.record_heartbeat("node-1", 10).await.unwrap();
        
        // Check healthy
        assert!(monitor.is_healthy("node-1").await);
        
        // Wait for timeout
        sleep(Duration::from_millis(150)).await;
        
        // Should be unhealthy now
        assert!(!monitor.is_healthy("node-1").await);
    }

    #[test]
    fn test_heartbeat_message_serialization() {
        let msg = HeartbeatMessage {
            node_id: "node-1".to_string(),
            timestamp: 1234567890,
            active_connections: 5,
            bandwidth_usage: BandwidthUsage {
                bytes_up: 1000,
                bytes_down: 2000,
                rate_kbps: 100,
            },
            system_stats: SystemStats {
                cpu_percent: 25.5,
                memory_percent: 60.0,
                uptime_seconds: 3600,
            },
        };
        
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("node-1"));
        assert!(json.contains("1234567890"));
    }
}
