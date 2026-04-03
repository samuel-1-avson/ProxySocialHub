//! P2-A9: Direct gRPC to Blockchain
//!
//! This module provides direct streaming communication between the Edge Gateway
//! and Solana blockchain without routing through Control API. This eliminates
//! 50-100ms latency and single points of failure.
//!
//! Key features:
//! - Streaming usage data with Ed25519 signatures for fraud prevention
//! - Real-time settlement confirmations
//! - Health monitoring with automatic reconnection
//! - Connection pooling for high availability
//! - Automatic batching for efficiency
//!
//! Architecture:
//! ```
//! +-------------+     gRPC Stream      +--------------+
//! | Edge Gateway|<-------------------->| Solana Node  |
//! |(this module)|  Usage + Settlements  | (Solana RPC) |
//! +-------------+                       +--------------+
//! ```
//!
//! Performance targets:
//! - Latency: <10ms end-to-end
//! - Throughput: >10,000 events/second
//! - Reconnection: <100ms
//! - Batch size: 100 events optimal

pub mod client;
pub mod grpc_stream;
pub mod signer;

use crate::error::Result;
use std::sync::Arc;
use tokio::sync::RwLock;

pub use client::SolanaClient;
pub use grpc_stream::BlockchainStream;
pub use signer::EventSigner;

/// Global blockchain manager that handles connections and streaming
pub struct BlockchainManager {
    /// Active gRPC stream connections
    streams: Arc<RwLock<Vec<Arc<BlockchainStream>>>>,

    /// Solana RPC client
    solana_client: Arc<SolanaClient>,

    /// Event signer for fraud prevention
    signer: Arc<EventSigner>,

    /// Configuration
    config: BlockchainConfig,
}

/// Configuration for blockchain connections
#[derive(Clone, Debug)]
pub struct BlockchainConfig {
    /// Primary Solana RPC endpoint
    pub primary_endpoint: String,

    /// Fallback endpoints for HA
    pub fallback_endpoints: Vec<String>,

    /// Gateway's Ed25519 private key (32 bytes, hex encoded)
    pub private_key_hex: String,

    /// Program ID for ProxyHubb on-chain program
    pub program_id: String,

    /// Treasury account for settlements
    pub treasury_pubkey: String,

    /// Number of connections to maintain
    pub connection_pool_size: usize,

    /// Batch size for usage events
    pub batch_size: usize,

    /// Flush interval in milliseconds
    pub flush_interval_ms: u64,

    /// Retry policy
    pub max_retries: u32,
    pub retry_delay_ms: u64,
}

impl Default for BlockchainConfig {
    fn default() -> Self {
        Self {
            primary_endpoint: "https://api.mainnet-beta.solana.com".to_string(),
            fallback_endpoints: vec![
                "https://solana-api.projectserum.com".to_string(),
                "https://rpc.ankr.com/solana".to_string(),
            ],
            private_key_hex: String::new(),
            program_id: "ProxyHubb111111111111111111111111111111111111".to_string(),
            treasury_pubkey: String::new(),
            connection_pool_size: 3,
            batch_size: 100,
            flush_interval_ms: 100,
            max_retries: 5,
            retry_delay_ms: 1000,
        }
    }
}

impl BlockchainManager {
    /// Create a new blockchain manager with the given configuration
    pub async fn new(config: BlockchainConfig) -> Result<Self> {
        let signer = Arc::new(EventSigner::from_hex(&config.private_key_hex)?);
        let solana_client = Arc::new(SolanaClient::new(&config).await?);

        let streams = Arc::new(RwLock::new(Vec::with_capacity(config.connection_pool_size)));

        let manager = Self {
            streams,
            solana_client,
            signer,
            config,
        };

        // Initialize connection pool
        manager.initialize_pool().await?;

        Ok(manager)
    }

    /// Initialize the connection pool with multiple streams
    async fn initialize_pool(&self) -> Result<()> {
        let mut streams = self.streams.write().await;

        for i in 0..self.config.connection_pool_size {
            let endpoint = if i == 0 {
                &self.config.primary_endpoint
            } else {
                self.config
                    .fallback_endpoints
                    .get((i - 1) % self.config.fallback_endpoints.len())
                    .unwrap_or(&self.config.primary_endpoint)
            };

            let stream = Arc::new(
                BlockchainStream::connect(endpoint, self.signer.clone(), self.config.clone())
                    .await?,
            );

            streams.push(stream);
        }

        tracing::info!(
            pool_size = streams.len(),
            "Blockchain connection pool initialized"
        );

        Ok(())
    }

    /// Submit a usage event to the blockchain
    pub async fn submit_usage(&self, event: UsageEvent) -> Result<()> {
        // Get a healthy stream
        let stream = self.get_healthy_stream().await?;

        // Sign the event
        let signed_event = self.signer.sign_event(&event);

        // Submit to blockchain
        stream.send_event(signed_event).await
    }

    /// Submit a batch of usage events efficiently
    pub async fn submit_usage_batch(&self, events: Vec<UsageEvent>) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }

        // Get a healthy stream
        let stream = self.get_healthy_stream().await?;

        // Sign and batch
        let signed_batch = self.signer.sign_batch(&events);

        // Submit batch
        stream.send_batch(signed_batch).await
    }

    /// Request settlement for a provider
    pub async fn request_settlement(
        &self,
        provider_id: String,
        amount_lamports: u64,
    ) -> Result<SettlementResponse> {
        let stream = self.get_healthy_stream().await?;
        stream
            .request_settlement(provider_id, amount_lamports)
            .await
    }

    /// Get current pricing information
    pub async fn get_pricing(&self) -> Result<PricingResponse> {
        let stream = self.get_healthy_stream().await?;
        stream.get_pricing().await
    }

    /// Get a healthy stream from the pool
    async fn get_healthy_stream(&self) -> Result<Arc<BlockchainStream>> {
        let streams = self.streams.read().await;

        // Try each stream in round-robin
        for stream in streams.iter() {
            if stream.is_healthy().await {
                return Ok(stream.clone());
            }
        }

        // All streams unhealthy - trigger reconnection
        drop(streams);
        self.reconnect_pool().await?;

        // Try again
        let streams = self.streams.read().await;
        streams.first().cloned().ok_or_else(|| {
            crate::error::Error::Internal("No blockchain streams available".to_string())
        })
    }

    /// Reconnect all streams in the pool
    async fn reconnect_pool(&self) -> Result<()> {
        tracing::warn!("Reconnecting all blockchain streams");

        let mut streams = self.streams.write().await;
        streams.clear();

        // Reinitialize
        drop(streams);
        self.initialize_pool().await
    }

    /// Start background health monitoring
    pub async fn start_health_monitor(&self) {
        let streams = self.streams.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));

            loop {
                interval.tick().await;

                let streams_guard = streams.read().await;
                let mut unhealthy_count = 0;
                for s in streams_guard.iter() {
                    if !s.is_healthy().await {
                        unhealthy_count += 1;
                    }
                }

                metrics::BLOCKCHAIN_UNHEALTHY_STREAMS.set(unhealthy_count as i64);

                if unhealthy_count > 0 {
                    tracing::warn!(
                        unhealthy = unhealthy_count,
                        total = streams_guard.len(),
                        "Some blockchain streams are unhealthy"
                    );
                }
            }
        });
    }
}

/// Usage event data structure
#[derive(Clone, Debug)]
pub struct UsageEvent {
    pub session_id: String,
    pub user_id: String,
    pub provider_id: String,
    pub node_id: String,
    pub bytes_up: u64,
    pub bytes_down: u64,
    pub timestamp_ms: u64,
    pub duration_seconds: u64,
    pub country_code: String,
    pub latency_ms: u32,
    pub packet_loss_percent: u32,
}

/// Signed usage event with fraud prevention
#[derive(Clone, Debug)]
pub struct SignedUsageEvent {
    pub event: UsageEvent,
    pub signature: Vec<u8>,
    pub nonce: u64,
}

/// Signed batch of events
#[derive(Clone, Debug)]
pub struct SignedBatch {
    pub events: Vec<SignedUsageEvent>,
    pub batch_signature: Vec<u8>,
    pub merkle_root: Vec<u8>,
}

/// Settlement response from blockchain
#[derive(Clone, Debug)]
pub struct SettlementResponse {
    pub transaction_signature: String,
    pub slot: u64,
    pub block_height: u64,
    pub confirmations: u32,
    pub status: SettlementStatus,
    pub error_message: Option<String>,
    pub confirmed_at_ms: u64,
    pub actual_amount_lamports: u64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SettlementStatus {
    Pending,
    Confirmed,
    Failed,
    Expired,
}

/// Pricing response
#[derive(Clone, Debug)]
pub struct PricingResponse {
    pub base_rate_usd_per_gb: f64,
    pub demand_multiplier: f64,
    pub sol_price_usd: f64,
    pub effective_rate_usd_per_gb: f64,
    pub effective_rate_sol_per_gb: f64,
    pub timestamp_ms: u64,
    pub valid_until_ms: u64,
}

/// Metrics for blockchain operations
pub mod metrics {
    use lazy_static::lazy_static;
    use prometheus::{Histogram, IntCounter, IntGauge};

    lazy_static! {
        pub static ref BLOCKCHAIN_EVENTS_SENT: IntCounter = prometheus::register_int_counter!(
            "edge_gateway_blockchain_events_sent_total",
            "Total usage events sent to blockchain"
        )
        .unwrap();
        pub static ref BLOCKCHAIN_BATCHES_SENT: IntCounter = prometheus::register_int_counter!(
            "edge_gateway_blockchain_batches_sent_total",
            "Total batches sent to blockchain"
        )
        .unwrap();
        pub static ref BLOCKCHAIN_UNHEALTHY_STREAMS: IntGauge = prometheus::register_int_gauge!(
            "edge_gateway_blockchain_unhealthy_streams",
            "Number of unhealthy blockchain streams"
        )
        .unwrap();
        pub static ref BLOCKCHAIN_LATENCY: Histogram = prometheus::register_histogram!(
            "edge_gateway_blockchain_latency_seconds",
            "Blockchain operation latency",
            prometheus::exponential_buckets(0.001, 2.0, 15).unwrap()
        )
        .unwrap();
        pub static ref BLOCKCHAIN_SETTLEMENTS: IntCounter = prometheus::register_int_counter!(
            "edge_gateway_blockchain_settlements_total",
            "Total settlements submitted"
        )
        .unwrap();
        pub static ref BLOCKCHAIN_RECONNECTS: IntCounter = prometheus::register_int_counter!(
            "edge_gateway_blockchain_reconnects_total",
            "Total stream reconnections"
        )
        .unwrap();
    }
}
