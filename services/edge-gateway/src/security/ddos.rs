//! Adaptive DDoS protection (P4-W13).
//!
//! # Components
//! - `SlidingWindowCounter` — per-IP request counter using a time-bucketed ring
//! - `AdaptiveRateLimiter`  — dynamic per-IP threshold, auto-tightens under load
//! - `BehaviorScorer`       — scores clients for anomalous patterns
//! - `ChallengeIssuer`      — token-based soft-block (challenge before allow)
//!
//! # Design
//! The global rate limiter uses coarse 1-second buckets stored in a DashMap so
//! reads never contend.  Under high load (> `load_threshold` req/s globally)
//! per-IP limits are halved automatically.

use std::{
    net::IpAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

// ---------------------------------------------------------------------------
// SlidingWindowCounter — per-IP, second-resolution
// ---------------------------------------------------------------------------

/// Resolution: 1-second buckets, `WINDOW` buckets kept.
const WINDOW: usize = 10; // 10-second sliding window

#[derive(Default)]
struct BucketWindow {
    counts: [AtomicU64; WINDOW],
    /// Unix second of the most recent bucket[0] write.
    epoch: AtomicU64,
}

impl BucketWindow {
    /// Increment the counter for the current second and return the
    /// total count across the whole window.
    fn increment(&self) -> u64 {
        let now = unix_second();
        let prev_epoch = self.epoch.load(Ordering::Relaxed);

        if now != prev_epoch {
            // Rotate: zero buckets that are older than the window
            let distance = (now.saturating_sub(prev_epoch)) as usize;
            let to_clear = distance.min(WINDOW);
            let start = (now as usize) % WINDOW;
            for i in 0..to_clear {
                self.counts[(start + WINDOW - i) % WINDOW].store(0, Ordering::Relaxed);
            }
            self.epoch.store(now, Ordering::Relaxed);
        }

        let slot = (now as usize) % WINDOW;
        self.counts[slot].fetch_add(1, Ordering::Relaxed);
        self.total()
    }

    fn total(&self) -> u64 {
        self.counts.iter().map(|c| c.load(Ordering::Relaxed)).sum()
    }
}

fn unix_second() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ---------------------------------------------------------------------------
// AdaptiveRateLimiter
// ---------------------------------------------------------------------------

/// Configuration for the adaptive rate limiter.
#[derive(Clone, Debug)]
pub struct RateLimitConfig {
    /// Normal per-IP limit over the sliding window (requests).
    pub base_limit: u64,
    /// Limit applied when global throughput exceeds `load_threshold`.
    pub tight_limit: u64,
    /// Global requests/second that triggers tight mode.
    pub load_threshold: u64,
    /// How long a blocked IP remains blocked.
    pub block_duration: Duration,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            base_limit: 200,        // 200 req / 10 s per IP
            tight_limit: 80,        // halved under load
            load_threshold: 50_000, // 50K req/s globally
            block_duration: Duration::from_secs(60),
        }
    }
}

/// Outcome of a rate-limit check.
#[derive(Debug, PartialEq, Eq)]
pub enum RateLimitResult {
    Allow,
    Challenge, // soft block — issue a challenge
    Block,     // hard block
}

pub struct AdaptiveRateLimiter {
    config: RateLimitConfig,
    windows: DashMap<IpAddr, Arc<BucketWindow>>,
    /// IPs in hard-block; value = expiry Unix second.
    blocked: DashMap<IpAddr, u64>,
    global_rps: AtomicU64,
}

impl AdaptiveRateLimiter {
    pub fn new(config: RateLimitConfig) -> Self {
        Self {
            config,
            windows: DashMap::new(),
            blocked: DashMap::new(),
            global_rps: AtomicU64::new(0),
        }
    }

    /// Check `ip` and return the decision.  Must be called for every request.
    pub fn check(&self, ip: IpAddr) -> RateLimitResult {
        // 1. Hard-block check
        if let Some(expiry) = self.blocked.get(&ip) {
            if unix_second() < *expiry {
                debug!("🚫 Hard-blocked IP: {}", ip);
                return RateLimitResult::Block;
            } else {
                drop(expiry);
                self.blocked.remove(&ip);
            }
        }

        // 2. Increment sliding window
        let window = self
            .windows
            .entry(ip)
            .or_insert_with(|| Arc::new(BucketWindow::default()))
            .clone();

        let count = window.increment();

        // 3. Update global RPS (approximate — relaxed)
        self.global_rps.fetch_add(1, Ordering::Relaxed);

        // 4. Choose limit based on global load
        let under_load = self.global_rps.load(Ordering::Relaxed) >= self.config.load_threshold;
        let limit = if under_load {
            self.config.tight_limit
        } else {
            self.config.base_limit
        };

        if count > limit * 2 {
            // Far above limit — hard block
            let expiry = unix_second() + self.config.block_duration.as_secs();
            self.blocked.insert(ip, expiry);
            warn!(
                "🛑 DDoS hard-block: {} (count={} limit={})",
                ip, count, limit
            );
            RateLimitResult::Block
        } else if count > limit {
            // Somewhat above — soft challenge
            debug!(
                "⚠️ DDoS challenge: {} (count={} limit={})",
                ip, count, limit
            );
            RateLimitResult::Challenge
        } else {
            RateLimitResult::Allow
        }
    }

    /// Called once per second from a background task to decay the global counter.
    pub fn tick_global(&self) {
        self.global_rps.store(0, Ordering::Relaxed);
    }

    /// Manually unblock an IP (admin action).
    pub fn unblock(&self, ip: IpAddr) {
        self.blocked.remove(&ip);
    }

    /// Return how many IPs are currently hard-blocked.
    pub fn blocked_count(&self) -> usize {
        let now = unix_second();
        self.blocked.iter().filter(|e| *e.value() > now).count()
    }
}

// ---------------------------------------------------------------------------
// BehaviorScorer — detect scanning, DoS, credential stuffing
// ---------------------------------------------------------------------------

/// Per-IP behavioral metrics.
#[derive(Default)]
struct BehaviorMetrics {
    /// Distinct target hosts contacted (proxy CONNECT destinations).
    distinct_targets: AtomicU64,
    /// Auth failures in the last window.
    auth_failures: AtomicU64,
    /// Connection errors (provider refused / timeout).
    conn_errors: AtomicU64,
    /// Last update Unix second (for TTL eviction).
    last_seen: AtomicU64,
}

/// Threat classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum ThreatLevel {
    None,
    Low,
    Medium,
    High,
    Critical,
}

pub struct BehaviorScorer {
    metrics: DashMap<IpAddr, Arc<BehaviorMetrics>>,
    /// TTL after which a quiet IP's record is evicted.
    ttl: Duration,
}

impl BehaviorScorer {
    pub fn new(ttl: Duration) -> Self {
        Self {
            metrics: DashMap::new(),
            ttl,
        }
    }

    fn get(&self, ip: IpAddr) -> Arc<BehaviorMetrics> {
        self.metrics
            .entry(ip)
            .or_insert_with(|| {
                let m = Arc::new(BehaviorMetrics::default());
                m.last_seen.store(unix_second(), Ordering::Relaxed);
                m
            })
            .clone()
    }

    pub fn record_target(&self, ip: IpAddr) {
        let m = self.get(ip);
        m.distinct_targets.fetch_add(1, Ordering::Relaxed);
        m.last_seen.store(unix_second(), Ordering::Relaxed);
    }

    pub fn record_auth_failure(&self, ip: IpAddr) {
        let m = self.get(ip);
        m.auth_failures.fetch_add(1, Ordering::Relaxed);
        m.last_seen.store(unix_second(), Ordering::Relaxed);
    }

    pub fn record_conn_error(&self, ip: IpAddr) {
        let m = self.get(ip);
        m.conn_errors.fetch_add(1, Ordering::Relaxed);
        m.last_seen.store(unix_second(), Ordering::Relaxed);
    }

    /// Score the IP and return its threat level.
    pub fn score(&self, ip: IpAddr) -> ThreatLevel {
        let Some(m) = self.metrics.get(&ip) else {
            return ThreatLevel::None;
        };

        let targets = m.distinct_targets.load(Ordering::Relaxed);
        let auth_fail = m.auth_failures.load(Ordering::Relaxed);
        let conn_err = m.conn_errors.load(Ordering::Relaxed);

        // Simple additive scoring (each contributes 1-3 points)
        let mut points = 0u32;
        if targets > 100 {
            points += 3;
        } else if targets > 20 {
            points += 1;
        }
        if auth_fail > 10 {
            points += 3;
        } else if auth_fail > 3 {
            points += 2;
        }
        if conn_err > 50 {
            points += 2;
        } else if conn_err > 10 {
            points += 1;
        }

        match points {
            0 => ThreatLevel::None,
            1..=2 => ThreatLevel::Low,
            3..=4 => ThreatLevel::Medium,
            _ => ThreatLevel::High,
        }
    }

    /// Evict records older than `ttl`.  Call periodically.
    pub fn evict_stale(&self) {
        let cutoff = unix_second().saturating_sub(self.ttl.as_secs());
        self.metrics
            .retain(|_, m| m.last_seen.load(Ordering::Relaxed) >= cutoff);
    }
}

// ---------------------------------------------------------------------------
// ChallengeIssuer — token-based soft block
// ---------------------------------------------------------------------------

/// Issues a random one-time challenge token.  Clients must echo it back in
/// the next request's `X-Challenge-Response` header to proceed.
pub struct ChallengeIssuer {
    /// token → expiry Unix second
    pending: DashMap<String, u64>,
    token_ttl: Duration,
}

impl ChallengeIssuer {
    pub fn new(token_ttl: Duration) -> Self {
        Self {
            pending: DashMap::new(),
            token_ttl,
        }
    }

    /// Generate and store a new challenge token.
    pub fn issue(&self) -> String {
        let token = uuid::Uuid::new_v4().to_string();
        let expiry = unix_second() + self.token_ttl.as_secs();
        self.pending.insert(token.clone(), expiry);
        token
    }

    /// Validate a token.  Returns `true` and consumes the token if valid.
    pub fn validate(&self, token: &str) -> bool {
        if let Some((_, expiry)) = self.pending.remove(token) {
            if unix_second() <= expiry {
                return true;
            }
        }
        false
    }

    /// Evict expired tokens.
    pub fn evict_expired(&self) {
        let now = unix_second();
        self.pending.retain(|_, expiry| *expiry > now);
    }
}

// ---------------------------------------------------------------------------
// Background maintenance task
// ---------------------------------------------------------------------------

/// Start a background task that ticks the rate limiter and evicts stale data.
pub fn start_maintenance(
    limiter: Arc<AdaptiveRateLimiter>,
    scorer: Arc<BehaviorScorer>,
    challenge: Arc<ChallengeIssuer>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        loop {
            interval.tick().await;
            limiter.tick_global();
            scorer.evict_stale();
            challenge.evict_expired();
        }
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn ip(a: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(1, 2, 3, a))
    }

    #[test]
    fn test_allow_under_limit() {
        let limiter = AdaptiveRateLimiter::new(RateLimitConfig {
            base_limit: 100,
            ..Default::default()
        });
        assert_eq!(limiter.check(ip(1)), RateLimitResult::Allow);
    }

    #[test]
    fn test_challenge_over_limit() {
        let limiter = AdaptiveRateLimiter::new(RateLimitConfig {
            base_limit: 5,
            tight_limit: 2,
            load_threshold: 1_000_000,
            block_duration: Duration::from_secs(60),
        });
        let mut result = RateLimitResult::Allow;
        for _ in 0..10 {
            result = limiter.check(ip(2));
        }
        assert_ne!(result, RateLimitResult::Allow);
    }

    #[test]
    fn test_block_far_over_limit() {
        let limiter = AdaptiveRateLimiter::new(RateLimitConfig {
            base_limit: 3,
            tight_limit: 2,
            load_threshold: 1_000_000,
            block_duration: Duration::from_secs(60),
        });
        let mut result = RateLimitResult::Allow;
        for _ in 0..20 {
            result = limiter.check(ip(3));
        }
        assert_eq!(result, RateLimitResult::Block);
    }

    #[test]
    fn test_unblock() {
        let limiter = AdaptiveRateLimiter::new(RateLimitConfig {
            base_limit: 1,
            tight_limit: 1,
            load_threshold: 1_000_000,
            block_duration: Duration::from_secs(60),
        });
        for _ in 0..10 {
            limiter.check(ip(4));
        }
        limiter.unblock(ip(4));
        assert_eq!(limiter.blocked_count(), 0);
    }

    #[test]
    fn test_behavior_scorer_threat_levels() {
        let scorer = BehaviorScorer::new(Duration::from_secs(300));
        let client = ip(10);

        assert_eq!(scorer.score(client), ThreatLevel::None);

        // >10 auth failures contributes 3 points → Medium (see score()).
        for _ in 0..11 {
            scorer.record_auth_failure(client);
        }
        assert!(scorer.score(client) >= ThreatLevel::Medium);
    }

    #[test]
    fn test_challenge_token_lifecycle() {
        let issuer = ChallengeIssuer::new(Duration::from_secs(30));
        let token = issuer.issue();
        assert!(issuer.validate(&token));
        // Token consumed — second validation fails
        assert!(!issuer.validate(&token));
    }

    #[test]
    fn test_challenge_invalid_token() {
        let issuer = ChallengeIssuer::new(Duration::from_secs(30));
        assert!(!issuer.validate("not-a-real-token"));
    }
}
