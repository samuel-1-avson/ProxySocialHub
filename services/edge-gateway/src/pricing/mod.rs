//! P2-A10: Real-time Pricing Awareness
//!
//! This module provides real-time pricing information from the blockchain oracle,
//! enabling dynamic pricing based on:
//! - Current SOL price in USD
//! - Network demand (utilization-based pricing)
//! - Geographic factors
//! - Provider quality tier
//!
//! The pricing engine feeds into the ML router to optimize provider selection
//! based on price-to-performance ratios.
//!
//! Key features:
//! - Real-time price streaming via WebSocket/gRPC
//! - Price caching with automatic refresh
//! - Demand-based pricing multipliers
//! - Historical price tracking for ML features
//!
//! Architecture:
//! ```
//! +--------------+     Price Stream     +--------------+     +-------------+
//! | Price Oracle |<-------------------->| Price Engine |---->| ML Router   |
//! | (Blockchain) |  SOL price, demand   | (this module)|     | (routing)   |
//! +--------------+                     +--------------+     +-------------+
//! ```

pub mod cache;
pub mod demand;
pub mod oracle;

use crate::error::Result;
use std::sync::Arc;
use tokio::sync::RwLock;

pub use cache::PriceCache;
pub use demand::DemandTracker;
pub use oracle::PriceOracle;

/// Global pricing engine that manages price data and feeds into routing decisions
pub struct PricingEngine {
    /// Connection to price oracle
    oracle: Arc<PriceOracle>,

    /// Local price cache
    cache: Arc<PriceCache>,

    /// Demand tracker for dynamic pricing
    demand: Arc<DemandTracker>,

    /// Current pricing configuration
    config: Arc<RwLock<PricingConfig>>,

    /// Historical prices for ML feature engineering
    history: Arc<RwLock<PriceHistory>>,
}

/// Pricing configuration
#[derive(Clone, Debug)]
pub struct PricingConfig {
    /// Base rate in USD per GB
    pub base_rate_usd_per_gb: f64,

    /// Minimum rate (floor)
    pub min_rate_usd_per_gb: f64,

    /// Maximum rate (ceiling)
    pub max_rate_usd_per_gb: f64,

    /// Demand multiplier sensitivity (0.0 - 2.0)
    pub demand_sensitivity: f64,

    /// Cache TTL in seconds
    pub cache_ttl_seconds: u64,

    /// Price update interval
    pub update_interval_seconds: u64,

    /// Number of historical prices to keep
    pub history_size: usize,
}

impl Default for PricingConfig {
    fn default() -> Self {
        Self {
            base_rate_usd_per_gb: 0.05,  // $0.05/GB base
            min_rate_usd_per_gb: 0.01,   // $0.01/GB floor
            max_rate_usd_per_gb: 0.50,   // $0.50/GB ceiling
            demand_sensitivity: 1.0,     // Linear response
            cache_ttl_seconds: 60,       // 1 minute cache
            update_interval_seconds: 30, // Update every 30s
            history_size: 1000,          // Keep last 1000 prices
        }
    }
}

/// Current price snapshot
#[derive(Clone, Debug)]
pub struct PriceSnapshot {
    /// Base rate in USD per GB
    pub base_rate_usd_per_gb: f64,

    /// Current demand multiplier (1.0 = normal)
    pub demand_multiplier: f64,

    /// SOL price in USD
    pub sol_price_usd: f64,

    /// Effective rate in USD per GB
    pub effective_rate_usd_per_gb: f64,

    /// Effective rate in SOL per GB
    pub effective_rate_sol_per_gb: f64,

    /// Timestamp when price was fetched
    pub timestamp_ms: u64,

    /// Price valid until (cache expiry)
    pub valid_until_ms: u64,
}

impl PriceSnapshot {
    /// Calculate cost in USD for given bandwidth
    pub fn cost_usd(&self, bytes: u64) -> f64 {
        let gb = bytes as f64 / 1_000_000_000.0;
        gb * self.effective_rate_usd_per_gb
    }

    /// Calculate cost in SOL for given bandwidth
    pub fn cost_sol(&self, bytes: u64) -> f64 {
        let gb = bytes as f64 / 1_000_000_000.0;
        gb * self.effective_rate_sol_per_gb
    }

    /// Convert to lamports
    pub fn cost_lamports(&self, bytes: u64) -> u64 {
        (self.cost_sol(bytes) * 1_000_000_000.0) as u64
    }
}

/// Provider-specific pricing (for quality tiers)
#[derive(Clone, Debug)]
pub struct ProviderPricing {
    /// Provider ID
    pub provider_id: String,

    /// Quality tier (1-5, 5 being best)
    pub quality_tier: u8,

    /// Geographic region
    pub region: String,

    /// Base rate multiplier for this provider
    pub rate_multiplier: f64,

    /// Current rate in USD/GB
    pub current_rate_usd_per_gb: f64,
}

/// Price history for trend analysis
#[derive(Clone, Debug)]
pub struct PriceHistory {
    /// Historical snapshots (oldest first)
    snapshots: Vec<PriceSnapshot>,

    /// Maximum size
    max_size: usize,
}

impl PriceHistory {
    fn new(max_size: usize) -> Self {
        Self {
            snapshots: Vec::with_capacity(max_size),
            max_size,
        }
    }

    /// Add a new snapshot
    fn push(&mut self, snapshot: PriceSnapshot) {
        if self.snapshots.len() >= self.max_size {
            self.snapshots.remove(0);
        }
        self.snapshots.push(snapshot);
    }

    /// Get average price over last N snapshots
    pub fn average_rate(&self, n: usize) -> Option<f64> {
        let count = self.snapshots.len().min(n);
        if count == 0 {
            return None;
        }

        let sum: f64 = self
            .snapshots
            .iter()
            .rev()
            .take(count)
            .map(|s| s.effective_rate_usd_per_gb)
            .sum();

        Some(sum / count as f64)
    }

    /// Get price trend (positive = increasing)
    pub fn trend(&self, window: usize) -> f64 {
        if self.snapshots.len() < 2 {
            return 0.0;
        }

        let recent = self.average_rate(window.min(self.snapshots.len() / 2));
        let older = self.average_rate(window);

        match (recent, older) {
            (Some(r), Some(o)) if o > 0.0 => (r - o) / o,
            _ => 0.0,
        }
    }

    /// Get volatility (standard deviation)
    pub fn volatility(&self, window: usize) -> f64 {
        let count = self.snapshots.len().min(window);
        if count < 2 {
            return 0.0;
        }

        let prices: Vec<f64> = self
            .snapshots
            .iter()
            .rev()
            .take(count)
            .map(|s| s.effective_rate_usd_per_gb)
            .collect();

        let mean = prices.iter().sum::<f64>() / prices.len() as f64;
        let variance = prices.iter().map(|p| (p - mean).powi(2)).sum::<f64>() / prices.len() as f64;

        variance.sqrt()
    }
}

impl PricingEngine {
    /// Create a new pricing engine
    pub async fn new(config: PricingConfig) -> Result<Self> {
        let oracle = Arc::new(PriceOracle::new(&config).await?);
        let cache = Arc::new(PriceCache::new(config.cache_ttl_seconds));
        let demand = Arc::new(DemandTracker::new());
        let history = Arc::new(RwLock::new(PriceHistory::new(config.history_size)));

        Ok(Self {
            oracle,
            cache,
            demand,
            config: Arc::new(RwLock::new(config)),
            history,
        })
    }

    /// Get current price snapshot
    pub async fn get_current_price(&self) -> Result<PriceSnapshot> {
        // Check cache first
        if let Some(cached) = self.cache.get().await {
            return Ok(cached);
        }

        // Fetch from oracle
        let oracle_price = self.oracle.fetch_price().await?;

        // Apply demand multiplier
        let demand_multiplier = self.demand.get_multiplier().await;

        // Build snapshot
        let config = self.config.read().await;
        let effective_rate = (oracle_price.base_rate_usd_per_gb * demand_multiplier)
            .clamp(config.min_rate_usd_per_gb, config.max_rate_usd_per_gb);

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let snapshot = PriceSnapshot {
            base_rate_usd_per_gb: oracle_price.base_rate_usd_per_gb,
            demand_multiplier,
            sol_price_usd: oracle_price.sol_price_usd,
            effective_rate_usd_per_gb: effective_rate,
            effective_rate_sol_per_gb: effective_rate / oracle_price.sol_price_usd,
            timestamp_ms: now,
            valid_until_ms: now + (config.cache_ttl_seconds * 1000),
        };

        // Update cache and history
        self.cache.set(snapshot.clone()).await;
        self.history.write().await.push(snapshot.clone());

        // Record metrics
        metrics::PRICE_USD_PER_GB.set(effective_rate);
        metrics::DEMAND_MULTIPLIER.set(demand_multiplier);
        metrics::SOL_PRICE_USD.set(oracle_price.sol_price_usd);

        Ok(snapshot)
    }

    /// Get provider-specific pricing
    pub async fn get_provider_pricing(&self, provider_id: &str) -> Result<ProviderPricing> {
        let base_price = self.get_current_price().await?;

        // Get provider tier from oracle
        let tier = self.oracle.get_provider_tier(provider_id).await?;

        // Calculate tier multiplier (tier 5 = 2x, tier 1 = 0.5x)
        let tier_multiplier = 0.5 + (tier as f64 * 0.3);

        Ok(ProviderPricing {
            provider_id: provider_id.to_string(),
            quality_tier: tier,
            region: "unknown".to_string(), // Could be enriched with geo data
            rate_multiplier: tier_multiplier,
            current_rate_usd_per_gb: base_price.effective_rate_usd_per_gb * tier_multiplier,
        })
    }

    /// Update demand based on current utilization
    pub async fn update_demand(&self, utilization_percent: f64) {
        self.demand.update(utilization_percent).await;

        // Invalidate cache to trigger recalculation
        self.cache.invalidate().await;
    }

    /// Start background price updates
    pub async fn start_price_updates(&self) {
        let engine_ref = Arc::new(self.clone());

        tokio::spawn(async move {
            let interval_secs = engine_ref.config.read().await.update_interval_seconds;
            let mut interval =
                tokio::time::interval(tokio::time::Duration::from_secs(interval_secs));

            loop {
                interval.tick().await;

                match engine_ref.get_current_price().await {
                    Ok(price) => {
                        tracing::debug!(
                            rate = price.effective_rate_usd_per_gb,
                            demand = price.demand_multiplier,
                            "Price updated"
                        );
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "Failed to update price");
                    }
                }
            }
        });
    }

    /// Get price history for ML features
    pub async fn get_price_features(&self) -> PriceFeatures {
        let history = self.history.read().await;
        let volatility_10 = history.volatility(10);
        let volatility_100 = history.volatility(100);
        let trend_10 = history.trend(10);
        let trend_100 = history.trend(100);

        PriceFeatures {
            current_rate: self.cache.get().await.map(|p| p.effective_rate_usd_per_gb),
            volatility_short: volatility_10,
            volatility_long: volatility_100,
            trend_short: trend_10,
            trend_long: trend_100,
            demand_multiplier: self.demand.get_multiplier().await,
        }
    }

    /// Calculate price-performance score for routing
    /// Higher score = better value (lower price, better quality)
    pub async fn calculate_value_score(
        &self,
        provider_id: &str,
        quality_score: f64, // 0.0 - 1.0
    ) -> Result<f64> {
        let pricing = self.get_provider_pricing(provider_id).await?;

        // Value = quality / price (normalized)
        // Higher quality, lower price = higher value score
        let normalized_price = pricing.current_rate_usd_per_gb / 0.10; // Normalize to ~0-5 range
        let value_score = (quality_score * 2.0) / (normalized_price + 0.1);

        Ok(value_score)
    }
}

impl Clone for PricingEngine {
    fn clone(&self) -> Self {
        Self {
            oracle: self.oracle.clone(),
            cache: self.cache.clone(),
            demand: self.demand.clone(),
            config: self.config.clone(),
            history: self.history.clone(),
        }
    }
}

/// ML feature vector from price data
#[derive(Clone, Debug)]
pub struct PriceFeatures {
    pub current_rate: Option<f64>,
    pub volatility_short: f64,
    pub volatility_long: f64,
    pub trend_short: f64,
    pub trend_long: f64,
    pub demand_multiplier: f64,
}

/// Metrics for pricing operations
pub mod metrics {
    use lazy_static::lazy_static;
    use prometheus::{Gauge, Histogram, IntCounter};

    lazy_static! {
        pub static ref PRICE_USD_PER_GB: Gauge = prometheus::register_gauge!(
            "edge_gateway_price_usd_per_gb",
            "Current effective price in USD per GB"
        )
        .unwrap();
        pub static ref DEMAND_MULTIPLIER: Gauge = prometheus::register_gauge!(
            "edge_gateway_demand_multiplier",
            "Current demand-based price multiplier"
        )
        .unwrap();
        pub static ref SOL_PRICE_USD: Gauge =
            prometheus::register_gauge!("edge_gateway_sol_price_usd", "Current SOL price in USD")
                .unwrap();
        pub static ref PRICE_UPDATES: IntCounter = prometheus::register_int_counter!(
            "edge_gateway_price_updates_total",
            "Total number of price updates fetched"
        )
        .unwrap();
        pub static ref PRICE_CACHE_HITS: IntCounter = prometheus::register_int_counter!(
            "edge_gateway_price_cache_hits_total",
            "Total number of price cache hits"
        )
        .unwrap();
        pub static ref PRICE_UPDATE_LATENCY: Histogram = prometheus::register_histogram!(
            "edge_gateway_price_update_latency_seconds",
            "Latency of price updates from oracle",
            prometheus::exponential_buckets(0.001, 2.0, 15).unwrap()
        )
        .unwrap();
    }
}
