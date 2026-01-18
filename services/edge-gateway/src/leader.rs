use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn, error};
use redis::{Client, Commands, AsyncCommands};
use uuid::Uuid;

/// LeaderElector handles distributed leader election using Redis.
/// It attempts to acquire a lock key. If successful, this instance is the leader.
/// It periodically renews the lock.
pub struct LeaderElector {
    client: Client,
    service_id: String,
    key: String,
    ttl_seconds: usize,
    is_leader: Arc<AtomicBool>,
}

impl LeaderElector {
    /// Create a new LeaderElector.
    /// `service_id` should be unique per instance (e.g., UUID).
    /// `key` is the Redis key to use for the lock (e.g., "edge-gateway-leader").
    /// `ttl_seconds` is how long the lock lasts before expiring (if not renewed).
    pub fn new(client: Client, service_id: String, key: String, ttl_seconds: usize) -> Self {
        Self {
            client,
            service_id,
            key,
            ttl_seconds,
            is_leader: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Returns the Arc<AtomicBool> for sharing status with other components
    pub fn status_flag(&self) -> Arc<AtomicBool> {
        self.is_leader.clone()
    }

    /// Returns true if this instance is currently the leader.
    pub fn is_leader(&self) -> bool {
        self.is_leader.load(Ordering::SeqCst)
    }

    /// Run the election loop in the background.
    /// This function blocks, so it should be spawned in a separate task.
    pub async fn run(self) {
        let mut con = match self.client.get_multiplexed_async_connection().await {
            Ok(c) => c,
            Err(e) => {
                error!("Failed to connect to Redis for leader election: {}", e);
                return;
            }
        };

        let sleep_duration = Duration::from_secs((self.ttl_seconds / 2) as u64);

        info!("Starting leader election loop for ID: {}", self.service_id);

        loop {
            // Try to acquire the lock
            // SET key service_id NX EX ttl
            let opts = redis::SetOptions::default()
                .conditional_set(redis::ExistenceCheck::NX)
                .with_expiration(redis::SetExpiry::EX(self.ttl_seconds));

            let result: redis::RedisResult<Option<String>> = con.set_options(&self.key, &self.service_id, opts).await;

            match result {
                Ok(Some(_)) => {
                    // Acquired lock!
                    if !self.is_leader.load(Ordering::SeqCst) {
                        info!("Leader lock acquired! I am now the leader.");
                        self.is_leader.store(true, Ordering::SeqCst);
                    }
                }
                Ok(None) => {
                    // Key exists. Check if we hold it (renewal)
                    // In a real implementation with NX, we can't accidentally overwrite unless we expire.
                    // But we need to renew if we ARE the leader.
                    // This simple loop using NX might lose leadership if we sleep too long, 
                    // or if we rely on NX failing to mean "someone else has it".
                    
                    // Better approach for renewal:
                    // script to check if value == service_id, if so, expire.
                    let script = redis::Script::new(r"
                        if redis.call('get', KEYS[1]) == ARGV[1] then
                            return redis.call('expire', KEYS[1], ARGV[2])
                        else
                            return 0
                        end
                    ");
                    
                    let renew_result: redis::RedisResult<i32> = script
                        .key(&self.key)
                        .arg(&self.service_id)
                        .arg(self.ttl_seconds)
                        .invoke_async(&mut con)
                        .await;
                        
                     match renew_result {
                        Ok(1) => {
                            // Renewed successfully
                             if !self.is_leader.load(Ordering::SeqCst) {
                                info!("Leader lock recovered/renewed.");
                                self.is_leader.store(true, Ordering::SeqCst);
                            }
                        }
                        Ok(_) => {
                            // Not our lock
                            if self.is_leader.load(Ordering::SeqCst) {
                                warn!("Lost leader lock!");
                                self.is_leader.store(false, Ordering::SeqCst);
                            }
                        }
                        Err(e) => {
                            error!("Error attempting to renew lock: {}", e);
                             // Assume lost if error persists
                        }
                     }
                }
                Err(e) => {
                    error!("Redis error during election: {}", e);
                    // Don't change status immediately on one error, but risky.
                }
            }

            tokio::time::sleep(sleep_duration).await;
        }
    }
}
