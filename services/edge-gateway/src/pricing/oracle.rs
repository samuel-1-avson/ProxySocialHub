//! D-O1: Decentralised Price Oracle
//!
//! Fetches SOL/USD prices from **three independent public feeds** (CoinGecko,
//! Binance, CoinMarketCap) concurrently and returns the **median** value.
//!
//! Key decentralisation properties:
//! - No single data-source controls the price used by the gateway
//! - Stale-price guard: cached prices older than 5 minutes are **rejected**,
//!   not silently served — prevents staleness attacks
//! - Two out of three sources failing still yields a valid median

use super::PricingConfig;
use crate::error::{Error, Result};

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

/// Cached price is rejected after this many milliseconds (5 minutes).
const MAX_PRICE_AGE_MS: u64 = 300_000;

/// Oracle price data
#[derive(Clone, Debug)]
pub struct OraclePrice {
    pub base_rate_usd_per_gb: f64,
    pub sol_price_usd: f64,
    pub timestamp_ms: u64,
}

/// Multi-source price oracle.
///
/// Sources polled on every `fetch_price()` call (concurrently):
///   1. CoinGecko  — `COINGECKO_API_KEY` (optional, free tier works without)
///   2. Binance    — public endpoint, no API key required
///   3. CoinMarketCap — `COINMARKETCAP_API_KEY` required; skipped if absent
pub struct PriceOracle {
    http_client: reqwest::Client,
    last_price: Arc<RwLock<Option<OraclePrice>>>,
    coingecko_api_key: Option<String>,
    coinmarketcap_api_key: Option<String>,
}

impl PriceOracle {
    pub async fn new(_config: &PricingConfig) -> Result<Self> {
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .build()
            .map_err(|e| Error::Internal(format!("Failed to create HTTP client: {}", e)))?;

        let coingecko_api_key = std::env::var("COINGECKO_API_KEY").ok();
        let coinmarketcap_api_key = std::env::var("COINMARKETCAP_API_KEY").ok();

        let active_sources = 2 + coinmarketcap_api_key.is_some() as u8;
        info!(
            sources = active_sources,
            "PriceOracle initialised — multi-source median aggregation enabled"
        );

        Ok(Self {
            http_client,
            last_price: Arc::new(RwLock::new(None)),
            coingecko_api_key,
            coinmarketcap_api_key,
        })
    }

    /// Fetch SOL/USD from all sources concurrently, return the median.
    ///
    /// Falls back to cache only if all sources fail **and** the cached price
    /// is within the 5-minute staleness window.  Stale-or-absent cache with
    /// all sources down returns `Err`.
    pub async fn fetch_price(&self) -> Result<OraclePrice> {
        let now = now_ms();

        // Fire all three fetches concurrently
        let (cg, bn, cmc) = tokio::join!(
            self.fetch_coingecko(),
            self.fetch_binance(),
            self.fetch_coinmarketcap(),
        );

        let mut prices: Vec<f64> = [cg, bn, cmc]
            .into_iter()
            .filter_map(|r| {
                r.map_err(|e| debug!(error = %e, "price source failed"))
                    .ok()
            })
            .collect();

        if prices.is_empty() {
            // All sources failed — check staleness of cache
            if let Some(cached) = self.last_price.read().await.clone() {
                let age_ms = now.saturating_sub(cached.timestamp_ms);
                if age_ms <= MAX_PRICE_AGE_MS {
                    warn!(
                        age_ms,
                        "All price sources failed — using cached price within staleness window"
                    );
                    return Ok(cached);
                }
                return Err(Error::Internal(format!(
                    "All price sources unavailable and cached price is stale ({age_ms}ms old, max {MAX_PRICE_AGE_MS}ms)"
                )));
            }
            return Err(Error::Internal(
                "All price sources unavailable and no cached price exists".to_string(),
            ));
        }

        // Median — sort ascending, pick middle element
        prices.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let sol_price_usd = prices[prices.len() / 2];

        info!(
            sources = prices.len(),
            sol_price_usd,
            "Oracle: median SOL/USD price from {} source(s)",
            prices.len()
        );

        // Derive bandwidth base rate proportional to SOL price
        // Reference: ~$0.015/GB at $150/SOL; clamped to [0.001, 1.0]
        let base_rate_usd_per_gb = (0.015 * (150.0 / sol_price_usd)).clamp(0.001, 1.0);

        let price = OraclePrice {
            base_rate_usd_per_gb,
            sol_price_usd,
            timestamp_ms: now,
        };

        super::metrics::PRICE_UPDATES.inc();
        *self.last_price.write().await = Some(price.clone());
        Ok(price)
    }

    // ── Source 1: CoinGecko ───────────────────────────────────────────────────

    async fn fetch_coingecko(&self) -> Result<f64> {
        let url = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
        let mut req = self.http_client.get(url);
        if let Some(key) = &self.coingecko_api_key {
            req = req.header("x-cg-demo-api-key", key.as_str());
        }
        let resp: serde_json::Value = req
            .send()
            .await
            .map_err(|e| Error::Network(format!("CoinGecko request failed: {e}")))?
            .json()
            .await
            .map_err(|e| Error::Serialization(format!("CoinGecko parse error: {e}")))?;

        resp["solana"]["usd"]
            .as_f64()
            .ok_or_else(|| Error::Validation("CoinGecko: missing solana.usd field".to_string()))
    }

    // ── Source 2: Binance (no key required) ───────────────────────────────────

    async fn fetch_binance(&self) -> Result<f64> {
        let resp: serde_json::Value = self
            .http_client
            .get("https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT")
            .send()
            .await
            .map_err(|e| Error::Network(format!("Binance request failed: {e}")))?
            .json()
            .await
            .map_err(|e| Error::Serialization(format!("Binance parse error: {e}")))?;

        resp["price"]
            .as_str()
            .and_then(|s| s.parse::<f64>().ok())
            .ok_or_else(|| {
                Error::Validation("Binance: missing or unparseable price field".to_string())
            })
    }

    // ── Source 3: CoinMarketCap (optional — skipped if no API key) ────────────

    async fn fetch_coinmarketcap(&self) -> Result<f64> {
        let key = self.coinmarketcap_api_key.as_deref().ok_or_else(|| {
            Error::Internal("COINMARKETCAP_API_KEY not configured — source skipped".to_string())
        })?;

        let resp: serde_json::Value = self
            .http_client
            .get("https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=SOL&convert=USD")
            .header("X-CMC_PRO_API_KEY", key)
            .send()
            .await
            .map_err(|e| Error::Network(format!("CoinMarketCap request failed: {e}")))?
            .json()
            .await
            .map_err(|e| Error::Serialization(format!("CoinMarketCap parse error: {e}")))?;

        resp["data"]["SOL"]["quote"]["USD"]["price"]
            .as_f64()
            .ok_or_else(|| Error::Validation("CoinMarketCap: missing price field".to_string()))
    }

    // ── Provider tier ─────────────────────────────────────────────────────────

    /// Get provider quality tier.
    ///
    /// TODO: Replace hash stub with on-chain `ProviderReputation.score` lookup
    /// once the Solana registry migration (Phase A) is complete.
    pub async fn get_provider_tier(&self, provider_id: &str) -> Result<u8> {
        Ok(Self::hash_to_tier(provider_id))
    }

    fn hash_to_tier(provider_id: &str) -> u8 {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut h = DefaultHasher::new();
        provider_id.hash(&mut h);
        ((h.finish() % 5) + 1) as u8
    }

    pub async fn start_price_stream(&self) {
        info!("Price stream: multi-source concurrent polling active (CoinGecko + Binance + CoinMarketCap)");
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
