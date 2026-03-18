//! P2-A10: Price Cache
//! 
//! Thread-safe price caching with TTL for efficient lookups.

use super::PriceSnapshot;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::Instant;

/// Cached price entry
struct CacheEntry {
    snapshot: PriceSnapshot,
    cached_at: Instant,
}

/// Thread-safe price cache
pub struct PriceCache {
    /// Cached price (if any)
    entry: Arc<RwLock<Option<CacheEntry>>>,
    
    /// TTL in seconds
    ttl_seconds: u64,
}

impl PriceCache {
    /// Create a new price cache
    pub fn new(ttl_seconds: u64) -> Self {
        Self {
            entry: Arc::new(RwLock::new(None)),
            ttl_seconds,
        }
    }
    
    /// Get cached price if valid
    pub async fn get(&self) -> Option<PriceSnapshot> {
        let entry = self.entry.read().await;
        
        if let Some(ref cached) = *entry {
            let elapsed = cached.cached_at.elapsed().as_secs();
            
            if elapsed < self.ttl_seconds {
                // Cache hit
                super::metrics::PRICE_CACHE_HITS.inc();
                return Some(cached.snapshot.clone());
            }
        }
        
        None // Cache miss or expired
    }
    
    /// Set cached price
    pub async fn set(&self, snapshot: PriceSnapshot) {
        let mut entry = self.entry.write().await;
        *entry = Some(CacheEntry {
            snapshot,
            cached_at: Instant::now(),
        });
    }
    
    /// Invalidate cache
    pub async fn invalidate(&self) {
        let mut entry = self.entry.write().await;
        *entry = None;
    }
    
    /// Check if cache has valid entry
    pub async fn is_valid(&self) -> bool {
        self.get().await.is_some()
    }
    
    /// Get cache TTL
    pub fn ttl(&self) -> u64 {
        self.ttl_seconds
    }
    
    /// Get time since last update (if cached)
    pub async fn age_seconds(&self) -> Option<u64> {
        let entry = self.entry.read().await;
        entry.as_ref().map(|e| e.cached_at.elapsed().as_secs())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    fn create_test_snapshot() -> PriceSnapshot {
        PriceSnapshot {
            base_rate_usd_per_gb: 0.05,
            demand_multiplier: 1.0,
            sol_price_usd: 100.0,
            effective_rate_usd_per_gb: 0.05,
            effective_rate_sol_per_gb: 0.0005,
            timestamp_ms: 1234567890,
            valid_until_ms: 1234567950,
        }
    }
    
    #[tokio::test]
    async fn test_cache_hit() {
        let cache = PriceCache::new(60);
        let snapshot = create_test_snapshot();
        
        cache.set(snapshot.clone()).await;
        
        let cached = cache.get().await;
        assert!(cached.is_some());
        assert_eq!(cached.unwrap().effective_rate_usd_per_gb, 0.05);
    }
    
    #[tokio::test]
    async fn test_cache_invalidation() {
        let cache = PriceCache::new(60);
        let snapshot = create_test_snapshot();
        
        cache.set(snapshot).await;
        cache.invalidate().await;
        
        let cached = cache.get().await;
        assert!(cached.is_none());
    }
}
