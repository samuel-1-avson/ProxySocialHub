//! P2-A10: Price Oracle Client
//! 
//! Fetches real-time pricing data from the blockchain oracle.
//! Supports both gRPC streaming and REST fallback.

use super::PricingConfig;
use crate::error::{Error, Result};

use std::sync::Arc;
use tokio::sync::RwLock;

/// Oracle price data
#[derive(Clone, Debug)]
pub struct OraclePrice {
    pub base_rate_usd_per_gb: f64,
    pub sol_price_usd: f64,
    pub timestamp_ms: u64,
}

/// Price oracle client
pub struct PriceOracle {
    /// gRPC endpoint for streaming prices
    grpc_endpoint: String,
    
    /// REST endpoint for fallback
    rest_endpoint: String,
    
    /// HTTP client for REST calls
    http_client: reqwest::Client,
    
    /// Last fetched price (for fallback)
    last_price: Arc<RwLock<Option<OraclePrice>>>,
}

impl PriceOracle {
    /// Create a new price oracle client
    pub async fn new(config: &PricingConfig) -> Result<Self> {
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| Error::Internal(format!("Failed to create HTTP client: {}", e)))?;
        
        // Get endpoints from environment or use defaults
        let grpc_endpoint = std::env::var("PRICE_ORACLE_GRPC")
            .unwrap_or_else(|_| "http://localhost:50051".to_string());
        
        let rest_endpoint = std::env::var("PRICE_ORACLE_REST")
            .unwrap_or_else(|_| "https://api.proxyhubb.io/v1/pricing".to_string());
        
        tracing::info!(
            grpc = %grpc_endpoint,
            rest = %rest_endpoint,
            "PriceOracle initialized"
        );
        
        Ok(Self {
            grpc_endpoint,
            rest_endpoint,
            http_client,
            last_price: Arc::new(RwLock::new(None)),
        })
    }
    
    /// Fetch current price from oracle
    pub async fn fetch_price(&self) -> Result<OraclePrice> {
        // Try gRPC first (if implemented)
        match self.fetch_grpc().await {
            Ok(price) => {
                super::metrics::PRICE_UPDATES.inc();
                *self.last_price.write().await = Some(price.clone());
                return Ok(price);
            }
            Err(e) => {
                tracing::debug!(error = %e, "gRPC price fetch failed, trying REST");
            }
        }
        
        // Fallback to REST
        match self.fetch_rest().await {
            Ok(price) => {
                super::metrics::PRICE_UPDATES.inc();
                *self.last_price.write().await = Some(price.clone());
                Ok(price)
            }
            Err(e) => {
                // Return last known price if available
                if let Some(last) = self.last_price.read().await.clone() {
                    tracing::warn!(
                        error = %e,
                        "Price fetch failed, using cached price"
                    );
                    return Ok(last);
                }
                Err(e)
            }
        }
    }
    
    /// Fetch price via gRPC (placeholder for full implementation)
    async fn fetch_grpc(&self) -> Result<OraclePrice> {
        // This would use the blockchain module's gRPC client
        // For now, return an error to trigger REST fallback
        Err(Error::Internal("gRPC not yet implemented".to_string()))
    }
    
    /// Fetch price via REST API
    async fn fetch_rest(&self) -> Result<OraclePrice> {
        let _timer = super::metrics::PRICE_UPDATE_LATENCY.start_timer();
        
        let response = self.http_client
            .get(&self.rest_endpoint)
            .send()
            .await
            .map_err(|e| Error::Network(format!("HTTP request failed: {}", e)))?;
        
        if !response.status().is_success() {
            return Err(Error::Network(format!(
                "HTTP error: {}",
                response.status()
            )));
        }
        
        // Parse response
        let price_data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| Error::Serialization(format!("JSON parse error: {}", e)))?;
        
        let base_rate = price_data["base_rate_usd_per_gb"]
            .as_f64()
            .ok_or_else(|| Error::Validation("Missing base_rate".to_string()))?;
        
        let sol_price = price_data["sol_price_usd"]
            .as_f64()
            .ok_or_else(|| Error::Validation("Missing sol_price".to_string()))?;
        
        let timestamp = price_data["timestamp_ms"]
            .as_u64()
            .unwrap_or_else(|| {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64
            });
        
        Ok(OraclePrice {
            base_rate_usd_per_gb: base_rate,
            sol_price_usd: sol_price,
            timestamp_ms: timestamp,
        })
    }
    
    /// Get provider quality tier from oracle
    pub async fn get_provider_tier(&self, provider_id: &str) -> Result<u8> {
        // In production, this would query the on-chain program
        // For now, return a default tier based on provider ID hash
        let tier = Self::hash_to_tier(provider_id);
        Ok(tier)
    }
    
    /// Hash provider ID to tier (1-5)
    fn hash_to_tier(provider_id: &str) -> u8 {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        
        let mut hasher = DefaultHasher::new();
        provider_id.hash(&mut hasher);
        let hash = hasher.finish();
        
        // Map to tier 1-5
        ((hash % 5) + 1) as u8
    }
    
    /// Start price stream (for real-time updates)
    pub async fn start_price_stream(&self) {
        // This would set up a gRPC streaming connection
        // and update prices in real-time
        tracing::info!("Price stream starting (placeholder implementation)");
    }
}
