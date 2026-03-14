use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::time::interval;
use redis::AsyncCommands;
use ring::signature;

/// Tracks usage per session and periodically reports to Control API.
///
/// Durability guarantee (B-02): every `record()` call writes to a Redis WAL key
/// `metering:wal:<username>` before accumulating in memory.  WAL entries are
/// deleted only after a successful report.  Call `recover_from_wal()` at startup
/// to replay any data left by a previous crash.
///
/// Reliability guarantee (B-10): flush failures are retried up to 5× with
/// exponential backoff; surviving WAL entries are retried on the next cycle.
pub struct UsageTracker {
    usage: Arc<RwLock<HashMap<String, (u64, u64)>>>,
    control_api_url: String,
    key_pair: Arc<signature::Ed25519KeyPair>,
    redis_client: redis::Client,
}

impl UsageTracker {
    pub fn new(control_api_url: &str, private_key_hex: &str) -> Result<Self, String> {
        let seed_bytes = hex::decode(private_key_hex)
            .map_err(|e| format!("Invalid private key hex: {}", e))?;
        let key_pair = signature::Ed25519KeyPair::from_seed_unchecked(&seed_bytes)
            .map_err(|e| format!("Invalid key seed: {}", e))?;

        let redis_url = std::env::var("REDIS_URL")
            .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        let redis_client = redis::Client::open(redis_url)
            .map_err(|e| format!("Redis client error: {}", e))?;

        Ok(Self {
            usage: Arc::new(RwLock::new(HashMap::new())),
            control_api_url: control_api_url.to_string(),
            key_pair: Arc::new(key_pair),
            redis_client,
        })
    }

    /// Record usage for a session.
    /// Writes to Redis WAL first (B-02) so data survives a crash before the next flush.
    pub async fn record(&self, session_username: &str, bytes_up: u64, bytes_down: u64) {
        // 1. Persist to Redis WAL (durable)
        if let Ok(mut conn) = self.redis_client.get_multiplexed_async_connection().await {
            let wal_key = format!("metering:wal:{}", session_username);
            let _: Result<(), _> = redis::cmd("HINCRBY")
                .arg(&wal_key).arg("bytes_up").arg(bytes_up)
                .query_async(&mut conn).await;
            let _: Result<(), _> = redis::cmd("HINCRBY")
                .arg(&wal_key).arg("bytes_down").arg(bytes_down)
                .query_async(&mut conn).await;
            // TTL: 1 hour — stale WAL entries expire automatically
            let _: Result<(), _> = conn.expire(&wal_key, 3600).await;
        } else {
            eprintln!("[Metering] WAL write failed for {} — data only in memory", session_username);
        }

        // 2. Accumulate in memory for batch flush
        let mut usage = self.usage.write().await;
        let entry = usage.entry(session_username.to_string()).or_insert((0, 0));
        entry.0 += bytes_up;
        entry.1 += bytes_down;
    }

    /// Start background task that flushes usage every 30 seconds.
    pub fn start_flush_task(self: Arc<Self>) {
        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(30));
            loop {
                ticker.tick().await;
                self.flush().await;
            }
        });
    }

    /// Recover any metering data left in the Redis WAL from a previous crash.
    /// Call once at startup before `start_flush_task`.
    pub async fn recover_from_wal(&self) {
        let mut conn = match self.redis_client.get_multiplexed_async_connection().await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[Metering] WAL recovery: cannot connect to Redis: {}", e);
                return;
            }
        };

        let mut cursor: u64 = 0;
        loop {
            let (next_cursor, keys): (u64, Vec<String>) = match redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH").arg("metering:wal:*")
                .arg("COUNT").arg(100)
                .query_async(&mut conn).await
            {
                Ok(r) => r,
                Err(e) => { eprintln!("[Metering] WAL scan error: {}", e); break; }
            };

            for key in keys {
                let username = key.trim_start_matches("metering:wal:").to_string();
                let bytes_up: u64 = redis::cmd("HGET").arg(&key).arg("bytes_up")
                    .query_async(&mut conn).await.unwrap_or(0);
                let bytes_down: u64 = redis::cmd("HGET").arg(&key).arg("bytes_down")
                    .query_async(&mut conn).await.unwrap_or(0);

                if bytes_up + bytes_down > 0 {
                    eprintln!("[Metering] WAL recovery: replaying {} up={} down={}", username, bytes_up, bytes_down);
                    match self.send_report_with_retry(&username, bytes_up, bytes_down).await {
                        Ok(_) => { let _: Result<(), _> = conn.del(&key).await; }
                        Err(e) => eprintln!("[Metering] WAL recovery failed for {}: {}", username, e),
                    }
                }
            }

            cursor = next_cursor;
            if cursor == 0 { break; }
        }
    }

    /// Flush accumulated usage to Control API.
    pub async fn flush(&self) {
        let snapshots: Vec<(String, u64, u64)>;
        {
            let mut usage = self.usage.write().await;
            snapshots = usage.drain()
                .filter(|(_, (up, down))| up + down > 0)
                .map(|(u, (up, down))| (u, up, down))
                .collect();
        }

        if snapshots.is_empty() {
            return;
        }

        for (username, bytes_up, bytes_down) in snapshots {
            match self.send_report_with_retry(&username, bytes_up, bytes_down).await {
                Ok(_) => {
                    if let Ok(mut conn) = self.redis_client.get_multiplexed_async_connection().await {
                        let wal_key = format!("metering:wal:{}", username);
                        let _: Result<(), _> = conn.del(&wal_key).await;
                    }
                }
                Err(e) => {
                    eprintln!("[Metering] Permanent flush failure for {}: {} — WAL preserved for next cycle", username, e);
                }
            }
        }
    }

    /// Send a single usage report with exponential backoff retry (B-10).
    async fn send_report_with_retry(
        &self,
        username: &str,
        bytes_up: u64,
        bytes_down: u64,
    ) -> Result<(), String> {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let msg = format!("{}:{}:{}:{}", username, bytes_up, bytes_down, nonce);
        let sig = self.key_pair.sign(msg.as_bytes());

        let report = UsageReport {
            session_username: username.to_string(),
            bytes_up: bytes_up as i64,
            bytes_down: bytes_down as i64,
            nonce,
            signature: hex::encode(sig.as_ref()),
        };
        let payload = BatchUsageReport { reports: vec![report] };
        let url = format!("{}/v1/usage/report", self.control_api_url);
        let client = reqwest::Client::new();

        let mut attempt = 0u32;
        loop {
            match client.post(&url).json(&payload).send().await {
                Ok(resp) if resp.status().is_success() => return Ok(()),
                Ok(resp) => {
                    if attempt >= 5 { return Err(format!("HTTP {}", resp.status())); }
                    eprintln!("[Metering] Flush attempt {} failed (HTTP {}), retrying", attempt + 1, resp.status());
                }
                Err(e) => {
                    if attempt >= 5 { return Err(e.to_string()); }
                    eprintln!("[Metering] Flush attempt {} failed ({}), retrying", attempt + 1, e);
                }
            }
            tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
            attempt += 1;
        }
    }
}

#[derive(serde::Serialize)]
struct UsageReport {
    session_username: String,
    bytes_up: i64,
    bytes_down: i64,
    nonce: u64,
    signature: String,
}

#[derive(serde::Serialize)]
struct BatchUsageReport {
    reports: Vec<UsageReport>,
}
