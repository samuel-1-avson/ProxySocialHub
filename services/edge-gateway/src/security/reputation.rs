//! IP reputation tracking + geo-blocking (P4-W13/W14).
//!
//! # Components
//! - `ReputationScore`  — per-IP composite trust score [0, 100]
//! - `IpReputationStore` — DashMap-backed store with score decay
//! - `GeoBlockList`     — country-code deny/allow list backed by GeoIP
//!
//! # Scoring model
//! Starting score = 50 (neutral).  Events raise/lower it:
//! - Auth failure   → −5
//! - DDoS block     → −20
//! - Bot detected   → −15
//! - Successful conn→ +1 (capped at 100)
//!
//! Scores decay toward 50 at 1 point/hour to forgive transient bad actors.

use std::{
    net::IpAddr,
    sync::atomic::{AtomicI32, Ordering},
    time::Duration,
};

use dashmap::DashMap;
use tracing::{info, warn};

// ---------------------------------------------------------------------------
// ReputationScore
// ---------------------------------------------------------------------------

const INITIAL_SCORE: i32 = 50;
const MAX_SCORE: i32 = 100;
const MIN_SCORE: i32 = 0;

/// Per-IP reputation entry.
pub struct ReputationEntry {
    score: AtomicI32,
    /// Unix second of last update (for decay computation).
    last_update: std::sync::atomic::AtomicU64,
}

impl ReputationEntry {
    fn new() -> Self {
        Self {
            score: AtomicI32::new(INITIAL_SCORE),
            last_update: std::sync::atomic::AtomicU64::new(unix_second()),
        }
    }

    fn apply_decay(&self) {
        let now = unix_second();
        let prev = self.last_update.swap(now, Ordering::Relaxed);
        let elapsed_hours = (now.saturating_sub(prev)) / 3600;
        if elapsed_hours == 0 {
            return;
        }

        let score = self.score.load(Ordering::Relaxed);
        let delta = (score - INITIAL_SCORE).signum() * (elapsed_hours as i32).min(score.abs());
        let new_score = (score - delta).clamp(MIN_SCORE, MAX_SCORE);
        self.score.store(new_score, Ordering::Relaxed);
    }

    fn adjust(&self, delta: i32) -> i32 {
        self.apply_decay();
        let new = (self.score.load(Ordering::Relaxed) + delta).clamp(MIN_SCORE, MAX_SCORE);
        self.score.store(new, Ordering::Relaxed);
        new
    }

    pub fn get(&self) -> i32 {
        self.apply_decay();
        self.score.load(Ordering::Relaxed)
    }
}

fn unix_second() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ---------------------------------------------------------------------------
// IpReputationStore
// ---------------------------------------------------------------------------

/// Threshold below which an IP is considered untrusted.
pub const UNTRUSTED_THRESHOLD: i32 = 20;
/// Threshold below which an IP is blocked entirely.
pub const BLOCK_THRESHOLD: i32 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReputationDecision {
    Trust,
    Challenge,
    Block,
}

pub struct IpReputationStore {
    entries: DashMap<IpAddr, ReputationEntry>,
    /// TTL for idle IPs.
    ttl: Duration,
}

impl IpReputationStore {
    pub fn new(ttl: Duration) -> Self {
        Self {
            entries: DashMap::new(),
            ttl,
        }
    }

    fn get_or_create(&self, ip: IpAddr) -> dashmap::mapref::one::RefMut<IpAddr, ReputationEntry> {
        self.entries.entry(ip).or_insert_with(ReputationEntry::new)
    }

    /// Record an auth failure.
    pub fn auth_failure(&self, ip: IpAddr) {
        let score = self.get_or_create(ip).adjust(-5);
        if score <= BLOCK_THRESHOLD {
            warn!("🚫 IP {} reputation critically low (score={})", ip, score);
        }
    }

    /// Record a DDoS block event.
    pub fn ddos_block(&self, ip: IpAddr) {
        let score = self.get_or_create(ip).adjust(-20);
        warn!("🛑 IP {} DDoS-blocked, score={}", ip, score);
    }

    /// Record a bot detection.
    pub fn bot_detected(&self, ip: IpAddr) {
        let score = self.get_or_create(ip).adjust(-15);
        info!("🤖 Bot detected from {}, score={}", ip, score);
    }

    /// Record a successful connection (trust signal).
    pub fn success(&self, ip: IpAddr) {
        self.get_or_create(ip).adjust(1);
    }

    /// Get the current score for an IP.
    pub fn score(&self, ip: IpAddr) -> i32 {
        self.entries
            .get(&ip)
            .map(|e| e.get())
            .unwrap_or(INITIAL_SCORE)
    }

    /// Decide how to treat `ip` based on its reputation.
    pub fn decide(&self, ip: IpAddr) -> ReputationDecision {
        let score = self.score(ip);
        if score <= BLOCK_THRESHOLD {
            ReputationDecision::Block
        } else if score <= UNTRUSTED_THRESHOLD {
            ReputationDecision::Challenge
        } else {
            ReputationDecision::Trust
        }
    }

    /// Evict entries that haven't been seen for longer than `ttl`.
    pub fn evict_stale(&self) {
        let cutoff = unix_second().saturating_sub(self.ttl.as_secs());
        self.entries
            .retain(|_, e| e.last_update.load(Ordering::Relaxed) >= cutoff);
    }
}

// ---------------------------------------------------------------------------
// GeoBlockList
// ---------------------------------------------------------------------------

/// Country-level access control backed by the MaxMind GeoIP database.
pub struct GeoBlockList {
    /// Two-letter ISO codes that are *denied*.
    denied: std::collections::HashSet<String>,
    /// Two-letter ISO codes that are *exclusively allowed*.
    /// If non-empty, all countries NOT in this set are denied.
    allowed: std::collections::HashSet<String>,
    geoip: Option<std::sync::Arc<maxminddb::Reader<Vec<u8>>>>,
}

impl GeoBlockList {
    /// Create a geo-block list from deny/allow sets.
    ///
    /// `allowed` takes precedence: if non-empty, any country not in `allowed`
    /// is denied regardless of `denied`.
    pub fn new(
        denied: impl IntoIterator<Item = String>,
        allowed: impl IntoIterator<Item = String>,
        geoip: Option<std::sync::Arc<maxminddb::Reader<Vec<u8>>>>,
    ) -> Self {
        Self {
            denied: denied.into_iter().collect(),
            allowed: allowed.into_iter().collect(),
            geoip,
        }
    }

    /// Returns `true` if `ip` is allowed through.
    pub fn is_allowed(&self, ip: IpAddr) -> bool {
        let country = self.lookup_country(ip);
        match country.as_deref() {
            None => {
                // No geo data — allow unless we have an explicit allow list
                self.allowed.is_empty()
            }
            Some(cc) => {
                if !self.allowed.is_empty() {
                    self.allowed.contains(cc)
                } else {
                    !self.denied.contains(cc)
                }
            }
        }
    }

    /// Look up the ISO 3166-1 alpha-2 country code for `ip` using GeoIP.
    pub fn lookup_country(&self, ip: IpAddr) -> Option<String> {
        let reader = self.geoip.as_ref()?;
        #[derive(serde::Deserialize)]
        struct Country {
            country: Option<CountryInner>,
        }
        #[derive(serde::Deserialize)]
        struct CountryInner {
            iso_code: Option<String>,
        }
        reader
            .lookup::<Country>(ip)
            .ok()
            .and_then(|r| r.country)
            .and_then(|c| c.iso_code)
            .map(|s| s.to_uppercase())
    }

    pub fn deny_count(&self) -> usize {
        self.denied.len()
    }
    pub fn allow_count(&self) -> usize {
        self.allowed.len()
    }
}

// ---------------------------------------------------------------------------
// Background decay task
// ---------------------------------------------------------------------------

pub fn start_decay_task(store: std::sync::Arc<IpReputationStore>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3600)); // hourly
        loop {
            interval.tick().await;
            store.evict_stale();
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
        IpAddr::V4(Ipv4Addr::new(10, 0, 0, a))
    }

    #[test]
    fn test_initial_score_is_neutral() {
        let store = IpReputationStore::new(Duration::from_secs(3600));
        assert_eq!(store.score(ip(1)), INITIAL_SCORE);
        assert_eq!(store.decide(ip(1)), ReputationDecision::Trust);
    }

    #[test]
    fn test_auth_failures_lower_score() {
        let store = IpReputationStore::new(Duration::from_secs(3600));
        for _ in 0..10 {
            store.auth_failure(ip(2));
        }
        let score = store.score(ip(2));
        assert!(score < INITIAL_SCORE);
    }

    #[test]
    fn test_ddos_block_causes_block_decision() {
        let store = IpReputationStore::new(Duration::from_secs(3600));
        // 3 DDoS blocks = −60 → score = max(0, 50−60) = 0
        for _ in 0..3 {
            store.ddos_block(ip(3));
        }
        assert_eq!(store.decide(ip(3)), ReputationDecision::Block);
    }

    #[test]
    fn test_success_raises_score() {
        let store = IpReputationStore::new(Duration::from_secs(3600));
        for _ in 0..20 {
            store.success(ip(4));
        }
        assert!(store.score(ip(4)) > INITIAL_SCORE);
    }

    #[test]
    fn test_score_capped_at_max() {
        let store = IpReputationStore::new(Duration::from_secs(3600));
        for _ in 0..200 {
            store.success(ip(5));
        }
        assert_eq!(store.score(ip(5)), MAX_SCORE);
    }

    #[test]
    fn test_geoblock_deny() {
        let geo = GeoBlockList::new(vec!["XX".to_string()], vec![], None);
        // Without GeoIP db and empty allow list, unknown IPs are allowed
        assert!(geo.is_allowed(ip(1)));
    }

    #[test]
    fn test_geoblock_allowlist_blocks_unknown() {
        let geo = GeoBlockList::new(vec![], vec!["GH".to_string()], None);
        // With non-empty allow list and no GeoIP, unknown IPs are denied
        assert!(!geo.is_allowed(ip(1)));
    }
}
