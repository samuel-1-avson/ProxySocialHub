//! D-L1: Distributed Leader Election with Redis primary + NATS fallback.
//!
//! ## Why two backends?
//!
//! The original implementation used Redis SET-NX exclusively.  If Redis is
//! unavailable, every gateway instance falls back to `is_leader = false`,
//! meaning **no leader exists** — DNS failover, region health publishing, and
//! config sync all stop silently.
//!
//! This version adds a NATS JetStream KV-based fallback that kicks in
//! automatically when Redis is unreachable:
//!
//!   1. **Redis primary** — fast, battle-tested SET NX + Lua renewal.
//!   2. **NATS KV fallback** — uses JetStream KV `CAS` (compare-and-swap) to
//!      elect a leader when Redis is down.
//!
//! The two paths share the same `is_leader: Arc<AtomicBool>` flag so the rest
//! of the codebase is unaffected.

use bytes::Bytes;
use redis::{AsyncCommands, Client as RedisClient};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, error, info, warn};

/// Controls how long the Redis lock lives before it must be renewed.
const LOCK_TTL_SECS: usize = 30;

/// How often the election loop runs (half the TTL so we renew with margin).
const TICK_SECS: u64 = 15;

/// How many consecutive Redis failures before we switch to NATS fallback.
const REDIS_FAIL_THRESHOLD: u32 = 3;

/// LeaderElector handles distributed leader election.
///
/// Primary backend: Redis SET NX + Lua renewal.
/// Fallback backend: NATS JetStream KV CAS when Redis is unreachable.
pub struct LeaderElector {
    redis_client: RedisClient,
    nats_url: String,
    service_id: String,
    key: String,
    is_leader: Arc<AtomicBool>,
}

impl LeaderElector {
    pub fn new(
        redis_client: RedisClient,
        service_id: String,
        key: String,
        _ttl_seconds: usize, // kept for API compat; we use LOCK_TTL_SECS internally
    ) -> Self {
        let nats_url = std::env::var("NATS_URL").unwrap_or_else(|_| "nats://nats:4222".to_string());
        Self {
            redis_client,
            nats_url,
            service_id,
            key,
            is_leader: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn status_flag(&self) -> Arc<AtomicBool> {
        self.is_leader.clone()
    }

    pub fn is_leader(&self) -> bool {
        self.is_leader.load(Ordering::SeqCst)
    }

    /// Run the election loop.  Blocks indefinitely — spawn in a dedicated task.
    pub async fn run(self) {
        let tick = Duration::from_secs(TICK_SECS);
        info!(
            service_id = %self.service_id,
            key = %self.key,
            "Leader election started (Redis primary, NATS fallback)"
        );

        let mut redis_con: Option<redis::aio::ConnectionManager> = None;
        let mut redis_fail_count: u32 = 0;

        loop {
            // ── Try Redis first ───────────────────────────────────────────────
            if redis_con.is_none() {
                match redis::aio::ConnectionManager::new(self.redis_client.clone()).await {
                    Ok(c) => {
                        info!("Leader election: Redis connected");
                        redis_con = Some(c);
                        redis_fail_count = 0;
                    }
                    Err(e) => {
                        warn!("Leader election: Redis unavailable ({e}), fail_count={redis_fail_count}");
                        redis_fail_count += 1;
                    }
                }
            }

            let redis_ok = if let Some(con) = redis_con.as_mut() {
                match self.try_redis_election(con).await {
                    Ok(is_leader) => {
                        self.is_leader.store(is_leader, Ordering::SeqCst);
                        redis_fail_count = 0;
                        true
                    }
                    Err(e) => {
                        warn!("Redis election error: {e}");
                        redis_fail_count += 1;
                        if e.is_connection_dropped() || e.is_connection_refusal() {
                            redis_con = None; // force reconnect next tick
                        }
                        false
                    }
                }
            } else {
                false
            };

            // ── NATS fallback when Redis is consistently unreachable ───────────
            if !redis_ok && redis_fail_count >= REDIS_FAIL_THRESHOLD {
                debug!("Redis failed {redis_fail_count} times — attempting NATS KV election");
                match self.try_nats_election().await {
                    Ok(is_leader) => {
                        if is_leader != self.is_leader.load(Ordering::SeqCst) {
                            if is_leader {
                                info!("Leader acquired via NATS KV fallback");
                            } else {
                                warn!("Lost leader via NATS KV fallback");
                            }
                        }
                        self.is_leader.store(is_leader, Ordering::SeqCst);
                    }
                    Err(e) => {
                        error!("NATS election error: {e}");
                        // Both backends failed — step down to be safe
                        if self.is_leader.load(Ordering::SeqCst) {
                            warn!("Both Redis and NATS failed — stepping down from leader role");
                            self.is_leader.store(false, Ordering::SeqCst);
                        }
                    }
                }
            }

            tokio::time::sleep(tick).await;
        }
    }

    // ── Redis backend ─────────────────────────────────────────────────────────

    async fn try_redis_election(
        &self,
        con: &mut redis::aio::ConnectionManager,
    ) -> redis::RedisResult<bool> {
        // Try to acquire the lock (NX = only if not exists)
        let acquired: Option<String> = redis::cmd("SET")
            .arg(&self.key)
            .arg(&self.service_id)
            .arg("NX")
            .arg("EX")
            .arg(LOCK_TTL_SECS)
            .query_async(con)
            .await?;

        if acquired.is_some() {
            return Ok(true); // we just won the lock
        }

        // Not acquired — try to renew if we already own it
        let script = redis::Script::new(
            r"
            if redis.call('get', KEYS[1]) == ARGV[1] then
                return redis.call('expire', KEYS[1], ARGV[2])
            else
                return 0
            end
            ",
        );
        let renewed: i32 = script
            .key(&self.key)
            .arg(&self.service_id)
            .arg(LOCK_TTL_SECS)
            .invoke_async(con)
            .await?;

        Ok(renewed == 1)
    }

    // ── NATS JetStream KV backend ─────────────────────────────────────────────

    async fn try_nats_election(&self) -> anyhow::Result<bool> {
        let client = async_nats::connect(&self.nats_url)
            .await
            .map_err(|e| anyhow::anyhow!("NATS connect failed: {e}"))?;

        let leader_value = Bytes::from(self.service_id.clone());

        let js = async_nats::jetstream::new(client);

        // Create or open the KV bucket for leader election
        let kv = js
            .create_key_value(async_nats::jetstream::kv::Config {
                bucket: "leader-election".to_string(),
                // TTL: entry expires after 2× our tick interval
                max_age: Duration::from_secs(TICK_SECS * 2),
                ..Default::default()
            })
            .await
            .map_err(|e| anyhow::anyhow!("NATS KV create/open failed: {e}"))?;

        match kv.get(&self.key).await {
            Ok(None) => {
                // Key absent — try to create it (CAS revision 0 = must not exist)
                match kv.create(&self.key, leader_value.clone()).await {
                    Ok(_) => Ok(true),   // we won
                    Err(_) => Ok(false), // someone else won the race
                }
            }
            Ok(Some(entry)) => {
                let current = String::from_utf8_lossy(&entry);
                if current == self.service_id {
                    // We own it — refresh value to extend TTL.
                    let _ = kv.put(&self.key, leader_value.clone()).await;
                    Ok(true)
                } else {
                    Ok(false) // someone else holds the lock
                }
            }
            Err(e) => Err(anyhow::anyhow!("NATS KV get failed: {e}")),
        }
    }
}
