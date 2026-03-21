use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn, error};
use redis::{Client, AsyncCommands};

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
        let sleep_duration = Duration::from_secs((self.ttl_seconds / 2) as u64);
        info!("Starting leader election loop for ID: {}", self.service_id);

        let mut con_opt = None;

        loop {
            // Get or recreate connection
            if con_opt.is_none() {
                match redis::aio::ConnectionManager::new(self.client.clone()).await {
                    Ok(c) => {
                        info!("Leader election: Connected to Redis via ConnectionManager.");
                        con_opt = Some(c);
                    }
                    Err(e) => {
                        error!("Failed to connect to Redis for leader election: {}. Retrying in {:?}...", e, sleep_duration);
                        tokio::time::sleep(sleep_duration).await;
                        continue;
                    }
                }
            }

            let con = con_opt.as_mut().unwrap();

            // Let's use the low-level cmd approach to be safe.
            let result: redis::RedisResult<Option<String>> = redis::cmd("SET")
                .arg(&self.key)
                .arg(&self.service_id)
                .arg("NX")
                .arg("EX")
                .arg(self.ttl_seconds)
                .query_async(con)
                .await;

            match result {
                Ok(Some(_)) => {
                    if !self.is_leader.load(Ordering::SeqCst) {
                        info!("Leader lock acquired! I am now the leader.");
                        self.is_leader.store(true, Ordering::SeqCst);
                    }
                }
                Ok(None) => {
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
                        .invoke_async(con)
                        .await;
                        
                     match renew_result {
                        Ok(1) => {
                             if !self.is_leader.load(Ordering::SeqCst) {
                                info!("Leader lock recovered/renewed.");
                                self.is_leader.store(true, Ordering::SeqCst);
                            }
                        }
                        Ok(_) => {
                            if self.is_leader.load(Ordering::SeqCst) {
                                warn!("Lost leader lock!");
                                self.is_leader.store(false, Ordering::SeqCst);
                            }
                        }
                        Err(e) => {
                            if e.is_connection_dropped() || e.is_connection_refusal() {
                                warn!("Lost connection to Redis during lock renewal: {}. Reconnecting...", e);
                                con_opt = None; // Trigger reconnection
                            } else {
                                error!("Error attempting to renew lock: {}", e);
                            }
                        }
                     }
                }
                Err(e) => {
                    if e.is_connection_dropped() || e.is_connection_refusal() {
                        warn!("Lost connection to Redis during election: {}. Reconnecting...", e);
                        con_opt = None; // Trigger reconnection
                    } else {
                        error!("Redis error during election: {}", e);
                    }
                }
            }

            tokio::time::sleep(sleep_duration).await;
        }
    }
}
