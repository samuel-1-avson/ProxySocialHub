use redis::AsyncCommands;
use ring::signature;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::time::interval;

/// Tracks usage per session and periodically reports to Control API.
///
/// Exactly-once guarantee (GW-08): every report carries a per-session monotonic
/// sequence number allocated with Redis INCR (`metering:seq:<session>`), and the
/// (seq, bytes) snapshot is persisted BEFORE sending (`metering:pending:<session>`).
/// Retries and crash replays re-send the SAME snapshot with the SAME nonce, so the
/// control-api `UNIQUE(session_username, nonce)` constraint deduplicates them while
/// still returning 2xx — a lost ack can therefore never double-charge, and a lost
/// report is always re-delivered.  WAL entries (`metering:wal:<session>`) are
/// decremented only after a successful ack, so bytes recorded during flight or
/// across restarts are never silently dropped.
///
/// Reliability guarantee (B-10): flush failures are retried up to 5× with
/// exponential backoff; unacked snapshots persist in Redis for the next cycle.
pub struct UsageTracker {
    usage: Arc<RwLock<HashMap<String, (u64, u64)>>>,
    control_api_url: String,
    gateway_auth_secret: String,
    key_pair: Arc<signature::Ed25519KeyPair>,
    redis_client: redis::Client,
    /// Max failed HTTP attempts before preserving the pending snapshot (default 5).
    /// Tests set this to 0 so unreachable control-api fails without backoff sleep.
    retry_limit: u32,
}

impl UsageTracker {
    pub fn new(
        control_api_url: &str,
        gateway_auth_secret: &str,
        private_key_hex: &str,
    ) -> Result<Self, String> {
        let seed_bytes =
            hex::decode(private_key_hex).map_err(|e| format!("Invalid private key hex: {}", e))?;
        let key_pair = signature::Ed25519KeyPair::from_seed_unchecked(&seed_bytes)
            .map_err(|e| format!("Invalid key seed: {}", e))?;

        let redis_url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        let redis_client =
            redis::Client::open(redis_url).map_err(|e| format!("Redis client error: {}", e))?;

        Ok(Self {
            usage: Arc::new(RwLock::new(HashMap::new())),
            control_api_url: control_api_url.to_string(),
            gateway_auth_secret: gateway_auth_secret.to_string(),
            key_pair: Arc::new(key_pair),
            redis_client,
            retry_limit: 5,
        })
    }

    /// Record usage for a session.
    /// Writes to Redis WAL first (B-02) so data survives a crash before the next flush.
    /// On Redis failure, spills to control-api Postgres (EV-05 lite) instead of memory-only loss.
    pub async fn record(&self, session_username: &str, bytes_up: u64, bytes_down: u64) {
        // 1. Persist to Redis WAL (durable)
        let mut wal_ok = false;
        if let Ok(mut conn) = self.redis_client.get_multiplexed_async_connection().await {
            let wal_key = format!("metering:wal:{}", session_username);
            let up_res: Result<(), _> = redis::cmd("HINCRBY")
                .arg(&wal_key)
                .arg("bytes_up")
                .arg(bytes_up)
                .query_async(&mut conn)
                .await;
            let down_res: Result<(), _> = redis::cmd("HINCRBY")
                .arg(&wal_key)
                .arg("bytes_down")
                .arg(bytes_down)
                .query_async(&mut conn)
                .await;
            let _: Result<(), _> = conn.expire(&wal_key, 3600).await;
            wal_ok = up_res.is_ok() && down_res.is_ok();
        }
        if !wal_ok {
            eprintln!(
                "[Metering] WAL write failed for {} — spilling to control-api",
                session_username
            );
            let spilled = self
                .spill_to_control_api(session_username, bytes_up, bytes_down, None, "redis_wal_fail")
                .await;
            if spilled {
                // Spill owns durability; skip in-memory accumulate to avoid double flush→report.
                return;
            }
        }

        // 2. Accumulate in memory for batch flush
        let mut usage = self.usage.write().await;
        let entry = usage.entry(session_username.to_string()).or_insert((0, 0));
        entry.0 += bytes_up;
        entry.1 += bytes_down;
    }

    /// Persist spill bytes to control-api when Redis WAL/pending cannot be written.
    /// Returns true when control-api accepted the spill (2xx/202).
    async fn spill_to_control_api(
        &self,
        username: &str,
        bytes_up: u64,
        bytes_down: u64,
        seq: Option<u64>,
        source: &str,
    ) -> bool {
        if bytes_up + bytes_down == 0 {
            return false;
        }
        let url = format!("{}/v1/gateway/metering/spill", self.control_api_url);
        let body = MeteringSpillRequest {
            session_username: username.to_string(),
            bytes_up: bytes_up as i64,
            bytes_down: bytes_down as i64,
            seq: seq.map(|s| s as i64),
            source: source.to_string(),
        };
        let client = reqwest::Client::new();
        match client
            .post(&url)
            .header("X-Gateway-Auth", &self.gateway_auth_secret)
            .json(&body)
            .timeout(Duration::from_secs(5))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 202 => {
                eprintln!(
                    "[Metering] spill accepted for {} ({}+{} bytes, source={})",
                    username, bytes_up, bytes_down, source
                );
                true
            }
            Ok(resp) => {
                eprintln!(
                    "[Metering] spill rejected for {} HTTP {} — data only in memory",
                    username,
                    resp.status()
                );
                false
            }
            Err(e) => {
                eprintln!(
                    "[Metering] spill request failed for {}: {} — data only in memory",
                    username, e
                );
                false
            }
        }
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

    /// Recover any metering data left in Redis by a previous crash.
    /// Call once at startup before `start_flush_task`. The flush sweep handles
    /// the actual replay (the first ticker tick fires immediately); this logs
    /// what was preserved so operators can see recovery volume.
    pub async fn recover_from_wal(&self) {
        let mut conn = match self.redis_client.get_multiplexed_async_connection().await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[Metering] WAL recovery: cannot connect to Redis: {}", e);
                return;
            }
        };

        for pattern in ["metering:wal:*", "metering:pending:*"] {
            let mut cursor: u64 = 0;
            let mut found = 0u64;
            loop {
                let (next_cursor, keys): (u64, Vec<String>) = match redis::cmd("SCAN")
                    .arg(cursor)
                    .arg("MATCH")
                    .arg(pattern)
                    .arg("COUNT")
                    .arg(100)
                    .query_async(&mut conn)
                    .await
                {
                    Ok(r) => r,
                    Err(e) => {
                        eprintln!("[Metering] recovery scan error: {}", e);
                        break;
                    }
                };
                found += keys.len() as u64;
                cursor = next_cursor;
                if cursor == 0 {
                    break;
                }
            }
            if found > 0 {
                eprintln!(
                    "[Metering] recovery: {} key(s) preserved under {}; replayed by flush sweep",
                    found, pattern
                );
            }
        }
    }

    /// Load an unacked report snapshot awaiting delivery confirmation.
    async fn load_pending(
        &self,
        conn: &mut redis::aio::MultiplexedConnection,
        username: &str,
    ) -> Option<(u64, u64, u64)> {
        let key = format!("metering:pending:{}", username);
        let map: std::collections::HashMap<String, String> =
            conn.hgetall(&key).await.unwrap_or_default();
        let seq = map.get("seq")?.parse().ok()?;
        let up = map
            .get("bytes_up")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let down = map
            .get("bytes_down")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        Some((seq, up, down))
    }

    /// Persist the exact (nonce, bytes) snapshot BEFORE first send so any retry
    /// or crash replay is byte-identical and deduplicates server-side.
    /// Returns false when Redis write fails (caller should spill).
    async fn save_pending(
        &self,
        conn: &mut redis::aio::MultiplexedConnection,
        username: &str,
        seq: u64,
        bytes_up: u64,
        bytes_down: u64,
    ) -> bool {
        let key = format!("metering:pending:{}", username);
        let fields: [(String, String); 3] = [
            ("seq".to_string(), seq.to_string()),
            ("bytes_up".to_string(), bytes_up.to_string()),
            ("bytes_down".to_string(), bytes_down.to_string()),
        ];
        let set_ok: Result<(), _> = conn.hset_multiple(&key, &fields).await;
        let _: Result<(), _> = conn.expire(&key, 3600).await;
        set_ok.is_ok()
    }

    /// After a successful (or deduplicated) ack: drop the pending snapshot and
    /// decrement the WAL by exactly the acked amounts — bytes recorded during
    /// flight survive for the next report.
    async fn clear_pending_advance(
        &self,
        conn: &mut redis::aio::MultiplexedConnection,
        username: &str,
        bytes_up: u64,
        bytes_down: u64,
    ) {
        let pending_key = format!("metering:pending:{}", username);
        let _: Result<(), _> = conn.del(&pending_key).await;

        let wal_key = format!("metering:wal:{}", username);
        let _: Result<i64, _> = redis::cmd("HINCRBY")
            .arg(&wal_key)
            .arg("bytes_up")
            .arg(-(bytes_up as i64))
            .query_async(conn)
            .await;
        let _: Result<i64, _> = redis::cmd("HINCRBY")
            .arg(&wal_key)
            .arg("bytes_down")
            .arg(-(bytes_down as i64))
            .query_async(conn)
            .await;

        // Clean up the WAL key once nothing remains unacked.
        let map: std::collections::HashMap<String, i64> =
            conn.hgetall(&wal_key).await.unwrap_or_default();
        let up = map.get("bytes_up").copied().unwrap_or(0);
        let down = map.get("bytes_down").copied().unwrap_or(0);
        if up <= 0 && down <= 0 {
            let _: Result<(), _> = conn.del(&wal_key).await;
        }
    }

    /// Allocate the next per-session report nonce atomically. INCR survives
    /// restarts and overlapping flushers; gaps from failed attempts are harmless
    /// because the server only requires (session, nonce) uniqueness.
    async fn alloc_seq(
        &self,
        conn: &mut redis::aio::MultiplexedConnection,
        username: &str,
    ) -> Result<u64, String> {
        let key = format!("metering:seq:{}", username);
        let seq: u64 = conn
            .incr(&key, 1)
            .await
            .map_err(|e| format!("seq alloc failed: {}", e))?;
        let _: Result<(), _> = conn.expire(&key, 24 * 3600).await;
        Ok(seq)
    }

    /// Send a pending snapshot (new or replayed) and settle its ack state.
    async fn deliver_pending(
        &self,
        conn: &mut redis::aio::MultiplexedConnection,
        username: &str,
        seq: u64,
        bytes_up: u64,
        bytes_down: u64,
    ) {
        match self
            .send_report_with_retry(username, bytes_up, bytes_down, seq)
            .await
        {
            Ok(_) => {
                self.clear_pending_advance(conn, username, bytes_up, bytes_down)
                    .await;
            }
            Err(e) => {
                eprintln!(
                    "[Metering] delivery failed for {} (seq {}): {} — pending snapshot preserved",
                    username, seq, e
                );
            }
        }
    }

    // DP-2: cross-pod drain ownership. Sections 1 and 3 of flush() scan
    // every user's pending/WAL keys. Without a lock, two pods can race the
    // WAL sweep: both see no pending snapshot, both alloc_seq, and the same
    // bytes get saved+delivered under two different nonces, defeating the
    // server-side (session, nonce) dedup and double-counting. One pod per
    // cycle owns the drain via SET NX EX; TTL covers 3 missed 30s cycles.
    async fn try_acquire_drain_lock(
        conn: &mut redis::aio::MultiplexedConnection,
    ) -> Option<String> {
        const DRAIN_LOCK_TTL_SECS: usize = 90;
        let token = format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        let res: redis::RedisResult<Option<String>> = redis::cmd("SET")
            .arg("metering:drain-lock")
            .arg(&token)
            .arg("NX")
            .arg("EX")
            .arg(DRAIN_LOCK_TTL_SECS)
            .query_async(conn)
            .await;
        match res {
            Ok(Some(_)) => Some(token),
            _ => None,
        }
    }

    async fn release_drain_lock(conn: &mut redis::aio::MultiplexedConnection, token: &str) {
        const RELEASE: &str = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
        let _: redis::RedisResult<i64> = redis::cmd("EVAL")
            .arg(RELEASE)
            .arg(1)
            .arg("metering:drain-lock")
            .arg(token)
            .query_async(conn)
            .await;
    }

    /// Flush accumulated usage to Control API.
    pub async fn flush(&self) {
        let mut conn = match self.redis_client.get_multiplexed_async_connection().await {
            Ok(c) => c,
            Err(e) => {
                eprintln!(
                    "[Metering] flush: no Redis ({}) — spilling in-memory usage",
                    e
                );
                let snapshots: Vec<(String, u64, u64)>;
                {
                    let mut usage = self.usage.write().await;
                    snapshots = usage
                        .drain()
                        .filter(|(_, (up, down))| up + down > 0)
                        .map(|(u, (up, down))| (u, up, down))
                        .collect();
                }
                for (username, bytes_up, bytes_down) in snapshots {
                    self.spill_to_control_api(
                        &username,
                        bytes_up,
                        bytes_down,
                        None,
                        "redis_flush_unavailable",
                    )
                    .await;
                }
                return;
            }
        };

        // Sections 1 and 3 touch every user's keys: only the drain owner
        // runs them. Section 2 (this pod's own snapshots) always runs; its
        // sessions cannot be in flight on another pod at the same time.
        let drain_token = Self::try_acquire_drain_lock(&mut conn).await;
        let drain_owner = drain_token.is_some();

        // 1. Re-deliver any unacked snapshots from previous cycles (byte-identical
        //    replays — server dedups by (session, nonce) on a lost ack).
        if drain_owner {
            let mut cursor: u64 = 0;
            loop {
                let (next_cursor, keys): (u64, Vec<String>) = match redis::cmd("SCAN")
                    .arg(cursor)
                    .arg("MATCH")
                    .arg("metering:pending:*")
                    .arg("COUNT")
                    .arg(100)
                    .query_async(&mut conn)
                    .await
                {
                    Ok(r) => r,
                    Err(e) => {
                        eprintln!("[Metering] pending scan error: {}", e);
                        break;
                    }
                };
                for key in keys {
                    let username = key.trim_start_matches("metering:pending:").to_string();
                    if let Some((seq, up, down)) = self.load_pending(&mut conn, &username).await {
                        if up + down == 0 {
                            let _: Result<(), _> = conn.del(&key).await;
                            continue;
                        }
                        self.deliver_pending(&mut conn, &username, seq, up, down)
                            .await;
                    }
                }
                cursor = next_cursor;
                if cursor == 0 {
                    break;
                }
            }
        }

        // 2. New snapshots from the in-memory accumulator.
        let snapshots: Vec<(String, u64, u64)>;
        {
            let mut usage = self.usage.write().await;
            snapshots = usage
                .drain()
                .filter(|(_, (up, down))| up + down > 0)
                .map(|(u, (up, down))| (u, up, down))
                .collect();
        }
        for (username, bytes_up, bytes_down) in snapshots {
            // If an older snapshot is still unacked, these bytes stay in the WAL
            // and are swept after it clears — never two in-flight reports per session.
            if self.load_pending(&mut conn, &username).await.is_some() {
                continue;
            }
            match self.alloc_seq(&mut conn, &username).await {
                Ok(seq) => {
                    if !self
                        .save_pending(&mut conn, &username, seq, bytes_up, bytes_down)
                        .await
                    {
                        eprintln!(
                            "[Metering] pending write failed for {} — spilling",
                            username
                        );
                        if self
                            .spill_to_control_api(
                                &username,
                                bytes_up,
                                bytes_down,
                                Some(seq),
                                "redis_pending_fail",
                            )
                            .await
                        {
                            self.clear_pending_advance(&mut conn, &username, bytes_up, bytes_down)
                                .await;
                        }
                        continue;
                    }
                    self.deliver_pending(&mut conn, &username, seq, bytes_up, bytes_down)
                        .await;
                }
                Err(e) => eprintln!("[Metering] {}: {}", username, e),
            }
        }

        // 3. WAL sweep — bytes whose in-memory copy vanished (crash between
        //    record() and flush) or that were waiting behind an unacked snapshot.
        if drain_owner {
            let mut cursor: u64 = 0;
            loop {
                let (next_cursor, keys): (u64, Vec<String>) = match redis::cmd("SCAN")
                    .arg(cursor)
                    .arg("MATCH")
                    .arg("metering:wal:*")
                    .arg("COUNT")
                    .arg(100)
                    .query_async(&mut conn)
                    .await
                {
                    Ok(r) => r,
                    Err(e) => {
                        eprintln!("[Metering] WAL scan error: {}", e);
                        break;
                    }
                };
                for key in keys {
                    let username = key.trim_start_matches("metering:wal:").to_string();
                    if self.load_pending(&mut conn, &username).await.is_some() {
                        continue;
                    }
                    let map: std::collections::HashMap<String, i64> =
                        conn.hgetall(&key).await.unwrap_or_default();
                    let up = map.get("bytes_up").copied().unwrap_or(0).max(0) as u64;
                    let down = map.get("bytes_down").copied().unwrap_or(0).max(0) as u64;
                    if up + down == 0 {
                        let _: Result<(), _> = conn.del(&key).await;
                        continue;
                    }
                    match self.alloc_seq(&mut conn, &username).await {
                        Ok(seq) => {
                            if !self.save_pending(&mut conn, &username, seq, up, down).await {
                                eprintln!(
                                    "[Metering] pending write failed for WAL {} — spilling",
                                    username
                                );
                                if self
                                    .spill_to_control_api(
                                        &username,
                                        up,
                                        down,
                                        Some(seq),
                                        "redis_pending_fail",
                                    )
                                    .await
                                {
                                    self.clear_pending_advance(&mut conn, &username, up, down)
                                        .await;
                                }
                                continue;
                            }
                            self.deliver_pending(&mut conn, &username, seq, up, down)
                                .await;
                        }
                        Err(e) => eprintln!("[Metering] {}: {}", username, e),
                    }
                }
                cursor = next_cursor;
                if cursor == 0 {
                    break;
                }
            }
        }

        if let Some(token) = drain_token {
            Self::release_drain_lock(&mut conn, &token).await;
        }
    }

    /// Send a single usage report with exponential backoff retry (B-10).
    /// The nonce MUST be the stable per-session sequence from the pending snapshot
    /// so that retries and crash replays deduplicate server-side.
    async fn send_report_with_retry(
        &self,
        username: &str,
        bytes_up: u64,
        bytes_down: u64,
        nonce: u64,
    ) -> Result<(), String> {
        let msg = format!("{}:{}:{}:{}", username, bytes_up, bytes_down, nonce);
        let sig = self.key_pair.sign(msg.as_bytes());

        let report = UsageReport {
            session_username: username.to_string(),
            bytes_up: bytes_up as i64,
            bytes_down: bytes_down as i64,
            nonce,
            signature: hex::encode(sig.as_ref()),
        };
        let payload = BatchUsageReport {
            reports: vec![report],
        };
        let url = format!("{}/v1/gateway/usage/report", self.control_api_url);
        let client = reqwest::Client::new();

        let mut attempt = 0u32;
        loop {
            match client
                .post(&url)
                .header("X-Gateway-Auth", &self.gateway_auth_secret)
                .json(&payload)
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => return Ok(()),
                Ok(resp) => {
                    if attempt >= self.retry_limit {
                        return Err(format!("HTTP {}", resp.status()));
                    }
                    eprintln!(
                        "[Metering] Flush attempt {} failed (HTTP {}), retrying",
                        attempt + 1,
                        resp.status()
                    );
                }
                Err(e) => {
                    if attempt >= self.retry_limit {
                        return Err(e.to_string());
                    }
                    eprintln!(
                        "[Metering] Flush attempt {} failed ({}), retrying",
                        attempt + 1,
                        e
                    );
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

#[derive(serde::Serialize)]
struct MeteringSpillRequest {
    session_username: String,
    bytes_up: i64,
    bytes_down: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    seq: Option<i64>,
    source: String,
}

#[cfg(test)]
mod exactly_once_tests {
    use super::*;
    use redis::AsyncCommands;
    use std::sync::OnceLock;
    use tokio::sync::Mutex;

    const TEST_SEED_HEX: &str = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

    /// Flush scans all `metering:pending:*` keys — tests must not run in parallel
    /// against the same Redis or they ack/steal each other's snapshots.
    fn redis_test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    async fn try_tracker(control_api_url: &str) -> Option<UsageTracker> {
        let redis_url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        let redis_client = redis::Client::open(redis_url.as_str()).ok()?;
        // Prove Redis is reachable before constructing the tracker.
        let mut ping = redis_client.get_multiplexed_async_connection().await.ok()?;
        let pong: String = redis::cmd("PING").query_async(&mut ping).await.ok()?;
        if pong != "PONG" {
            return None;
        }

        let seed_bytes = hex::decode(TEST_SEED_HEX).expect("seed");
        let key_pair =
            signature::Ed25519KeyPair::from_seed_unchecked(&seed_bytes).expect("keypair");
        Some(UsageTracker {
            usage: Arc::new(RwLock::new(HashMap::new())),
            control_api_url: control_api_url.to_string(),
            gateway_auth_secret: "test-gateway-secret".to_string(),
            key_pair: Arc::new(key_pair),
            redis_client,
            retry_limit: 0, // fail fast for integration tests
        })
    }

    async fn cleanup(tracker: &UsageTracker, username: &str) {
        if let Ok(mut conn) = tracker
            .redis_client
            .get_multiplexed_async_connection()
            .await
        {
            for key in [
                format!("metering:wal:{}", username),
                format!("metering:pending:{}", username),
                format!("metering:seq:{}", username),
            ] {
                let _: Result<(), _> = conn.del(key).await;
            }
        }
    }

    /// Drop any leftover metering keys so flush's global pending SCAN cannot
    /// pick up debris from a prior crashed/parallel run.
    async fn sweep_metering_keys(tracker: &UsageTracker) {
        let Ok(mut conn) = tracker
            .redis_client
            .get_multiplexed_async_connection()
            .await
        else {
            return;
        };
        for pattern in [
            "metering:pending:*",
            "metering:wal:*",
            "metering:seq:test-*",
        ] {
            let mut cursor: u64 = 0;
            loop {
                let (next, keys): (u64, Vec<String>) = match redis::cmd("SCAN")
                    .arg(cursor)
                    .arg("MATCH")
                    .arg(pattern)
                    .arg("COUNT")
                    .arg(100)
                    .query_async(&mut conn)
                    .await
                {
                    Ok(r) => r,
                    Err(_) => break,
                };
                for key in keys {
                    let _: Result<(), _> = conn.del(key).await;
                }
                cursor = next;
                if cursor == 0 {
                    break;
                }
            }
        }
    }

    #[tokio::test]
    async fn alloc_seq_is_monotonic_per_session() {
        let _guard = redis_test_lock().lock().await;
        let Some(tracker) = try_tracker("http://127.0.0.1:9").await else {
            eprintln!("skip: Redis not available");
            return;
        };
        let user = format!("test-seq-{}", uuid_lite());
        cleanup(&tracker, &user).await;
        let mut conn = tracker
            .redis_client
            .get_multiplexed_async_connection()
            .await
            .unwrap();
        let a = tracker.alloc_seq(&mut conn, &user).await.unwrap();
        let b = tracker.alloc_seq(&mut conn, &user).await.unwrap();
        assert_eq!(a + 1, b);
        cleanup(&tracker, &user).await;
    }

    #[tokio::test]
    async fn pending_snapshot_roundtrip() {
        let _guard = redis_test_lock().lock().await;
        let Some(tracker) = try_tracker("http://127.0.0.1:9").await else {
            eprintln!("skip: Redis not available");
            return;
        };
        let user = format!("test-pending-{}", uuid_lite());
        cleanup(&tracker, &user).await;
        let mut conn = tracker
            .redis_client
            .get_multiplexed_async_connection()
            .await
            .unwrap();
        tracker.save_pending(&mut conn, &user, 42, 100, 200).await;
        let loaded = tracker.load_pending(&mut conn, &user).await;
        assert_eq!(loaded, Some((42, 100, 200)));
        cleanup(&tracker, &user).await;
    }

    #[tokio::test]
    async fn clear_pending_decrements_wal_exactly() {
        let _guard = redis_test_lock().lock().await;
        let Some(tracker) = try_tracker("http://127.0.0.1:9").await else {
            eprintln!("skip: Redis not available");
            return;
        };
        let user = format!("test-clear-{}", uuid_lite());
        cleanup(&tracker, &user).await;

        tracker.record(&user, 500, 700).await;
        let mut conn = tracker
            .redis_client
            .get_multiplexed_async_connection()
            .await
            .unwrap();
        assert!(
            tracker.save_pending(&mut conn, &user, 7, 500, 700).await,
            "pending write should succeed"
        );
        tracker
            .clear_pending_advance(&mut conn, &user, 500, 700)
            .await;

        assert!(tracker.load_pending(&mut conn, &user).await.is_none());
        let wal_key = format!("metering:wal:{}", user);
        let exists: bool = conn.exists(&wal_key).await.unwrap();
        assert!(!exists, "WAL should be deleted once counters hit zero");
        cleanup(&tracker, &user).await;
    }

    #[tokio::test]
    async fn flush_preserves_pending_when_control_api_unreachable() {
        let _guard = redis_test_lock().lock().await;
        // Unreachable control-api + retry_limit=0 → pending kept with stable seq.
        let Some(tracker) = try_tracker("http://127.0.0.1:1").await else {
            eprintln!("skip: Redis not available");
            return;
        };
        let user = format!("test-flush-{}", uuid_lite());
        sweep_metering_keys(&tracker).await;
        cleanup(&tracker, &user).await;

        tracker.record(&user, 111, 222).await;
        tracker.flush().await;

        let mut conn = tracker
            .redis_client
            .get_multiplexed_async_connection()
            .await
            .unwrap();
        let pending = tracker
            .load_pending(&mut conn, &user)
            .await
            .expect("pending snapshot must survive failed delivery");
        assert_eq!(pending, (1, 111, 222));

        // Second flush must re-deliver the SAME snapshot (no second seq alloc).
        tracker.flush().await;
        let pending2 = tracker
            .load_pending(&mut conn, &user)
            .await
            .expect("pending still present");
        assert_eq!(
            pending2,
            (1, 111, 222),
            "seq must stay stable across retries"
        );

        cleanup(&tracker, &user).await;
    }

    #[tokio::test]
    async fn flush_with_mock_ack_clears_pending_and_wal() {
        let _guard = redis_test_lock().lock().await;
        let listener = match tokio::net::TcpListener::bind("127.0.0.1:0").await {
            Ok(l) => l,
            Err(_) => {
                eprintln!("skip: cannot bind mock control-api");
                return;
            }
        };
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    break;
                };
                // Minimal HTTP/1.1 200 so reqwest succeeds.
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                let mut buf = [0u8; 1024];
                let _ = sock.read(&mut buf).await;
                let _ = sock
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
                    .await;
            }
        });

        let Some(tracker) = try_tracker(&format!("http://{addr}")).await else {
            eprintln!("skip: Redis not available");
            return;
        };
        let user = format!("test-ack-{}", uuid_lite());
        sweep_metering_keys(&tracker).await;
        cleanup(&tracker, &user).await;

        tracker.record(&user, 50, 60).await;
        tracker.flush().await;

        let mut conn = tracker
            .redis_client
            .get_multiplexed_async_connection()
            .await
            .unwrap();
        assert!(
            tracker.load_pending(&mut conn, &user).await.is_none(),
            "ack must clear pending"
        );
        let wal_exists: bool = conn.exists(format!("metering:wal:{}", user)).await.unwrap();
        assert!(!wal_exists, "ack must clear exhausted WAL");

        cleanup(&tracker, &user).await;
    }

    fn uuid_lite() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("{nanos:x}")
    }
}
