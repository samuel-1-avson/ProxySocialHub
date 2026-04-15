//! P2-A9: gRPC Streaming Implementation
//!
//! Manages bidirectional gRPC streams for blockchain communication.
//! Handles connection lifecycle, reconnection, and backpressure.

use super::{
    metrics, BlockchainConfig, PricingResponse, SettlementResponse, SettlementStatus, SignedBatch,
    SignedUsageEvent,
};
use crate::blockchain::signer::EventSigner;
use crate::error::{Error, Result};

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};
use tokio::time::Instant;
use tonic::{transport::Channel, Request};

mod proto {
    include!("proto/proxyhub.blockchain.v1.rs");
}

pub use proto::{
    PingRequest, PongResponse, PricingRequest, PricingResponse as PricingResponse_,
    SettlementRequest, SettlementResponse as SettlementResponse_, StreamStatus, UsageEvent,
    UsageEventBatch,
};
type UsageStreamClient = proto::usage_stream_client::UsageStreamClient<Channel>;

/// Bidirectional gRPC stream to blockchain
pub struct BlockchainStream {
    /// Underlying gRPC client
    client: RwLock<UsageStreamClient>,

    /// Event signer for fraud prevention
    signer: Arc<EventSigner>,

    /// Configuration
    config: BlockchainConfig,

    /// Channel for sending events
    event_tx: mpsc::Sender<SignedUsageEvent>,

    /// Last health check timestamp
    last_health_check: RwLock<Instant>,

    /// Stream health status
    is_healthy: RwLock<bool>,

    /// Connection endpoint
    endpoint: String,

    /// Connection established at
    connected_at: Instant,

    /// Events sent counter
    events_sent: RwLock<u64>,
}

impl BlockchainStream {
    /// Connect to blockchain gRPC endpoint
    pub async fn connect(
        endpoint: &str,
        signer: Arc<EventSigner>,
        config: BlockchainConfig,
    ) -> Result<Self> {
        let channel = Channel::from_shared(endpoint.to_string())
            .map_err(|e| Error::Internal(format!("Invalid endpoint: {}", e)))?
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .connect()
            .await
            .map_err(|e| Error::BlockchainConnection(format!("Failed to connect: {}", e)))?;

        let client = UsageStreamClient::new(channel);

        // Test connection with ping
        let mut test_client = client.clone();
        let ping = PingRequest {
            client_timestamp_ms: Instant::now().elapsed().as_millis() as u64,
            client_version: env!("CARGO_PKG_VERSION").to_string(),
        };

        match test_client.ping(Request::new(ping)).await {
            Ok(response) => {
                let pong = response.into_inner();
                tracing::info!(
                    endpoint = endpoint,
                    server_version = pong.server_version,
                    health = ?pong.health,
                    "Connected to blockchain gRPC endpoint"
                );
            }
            Err(e) => {
                tracing::warn!(
                    endpoint = endpoint,
                    error = %e,
                    "Health check failed but proceeding with connection"
                );
            }
        }

        // Create event channel with bounded buffer for backpressure
        let (event_tx, mut event_rx) = mpsc::channel::<SignedUsageEvent>(config.batch_size * 2);

        let stream = Self {
            client: RwLock::new(client),
            signer,
            config: config.clone(),
            event_tx,
            last_health_check: RwLock::new(Instant::now()),
            is_healthy: RwLock::new(true),
            endpoint: endpoint.to_string(),
            connected_at: Instant::now(),
            events_sent: RwLock::new(0),
        };

        // Start background tasks
        let stream_clone = Arc::new(stream);

        // Spawn event batching task
        let batcher_stream = stream_clone.clone();
        tokio::spawn(async move {
            batcher_stream.run_event_batcher(event_rx).await;
        });

        // Spawn health check task
        let health_stream = stream_clone.clone();
        tokio::spawn(async move {
            health_stream.run_health_checks().await;
        });

        // Return the stream from Arc
        Arc::try_unwrap(stream_clone)
            .map_err(|_| Error::Internal("Failed to unwrap Arc".to_string()))
    }

    /// Run the event batching loop
    async fn run_event_batcher(&self, mut rx: mpsc::Receiver<SignedUsageEvent>) {
        let mut batch = Vec::with_capacity(self.config.batch_size);
        let mut last_flush = Instant::now();

        loop {
            let timeout = Duration::from_millis(self.config.flush_interval_ms);
            let should_flush = batch.len() >= self.config.batch_size
                || (!batch.is_empty() && last_flush.elapsed() >= timeout);

            tokio::select! {
                Some(event) = rx.recv() => {
                    batch.push(event);

                    if batch.len() >= self.config.batch_size {
                        self.flush_batch(std::mem::take(&mut batch)).await;
                        batch = Vec::with_capacity(self.config.batch_size);
                        last_flush = Instant::now();
                    }
                }
                _ = tokio::time::sleep(timeout), if !batch.is_empty() => {
                    self.flush_batch(std::mem::take(&mut batch)).await;
                    batch = Vec::with_capacity(self.config.batch_size);
                    last_flush = Instant::now();
                }
                else => {
                    // Channel closed
                    if !batch.is_empty() {
                        self.flush_batch(batch).await;
                    }
                    break;
                }
            }
        }
    }

    /// Flush a batch of events to the blockchain
    async fn flush_batch(&self, batch: Vec<SignedUsageEvent>) {
        if batch.is_empty() {
            return;
        }

        let batch_size = batch.len();
        let _timer = metrics::BLOCKCHAIN_LATENCY.start_timer();

        // Convert to protobuf events using the generated transport schema.
        let proto_events = self.signer.create_proto_batch(&batch).events;

        // Send with retries
        let mut retries = 0;
        loop {
            let mut client = self.client.write().await;

            // Create a stream from the batch
            let batch_stream = tokio_stream::iter(proto_events.clone());

            match client.stream_usage(Request::new(batch_stream)).await {
                Ok(response) => {
                    let mut stream = response.into_inner();

                    // Wait for acknowledgment
                    match stream.message().await {
                        Ok(Some(status)) => {
                            metrics::BLOCKCHAIN_BATCHES_SENT.inc();
                            metrics::BLOCKCHAIN_EVENTS_SENT.inc_by(batch_size as u64);

                            *self.events_sent.write().await += batch_size as u64;

                            tracing::debug!(
                                batch_size = batch_size,
                                accepted = status.events_accepted,
                                rejected = status.events_rejected,
                                "Batch sent successfully"
                            );

                            return;
                        }
                        Ok(None) => {
                            tracing::warn!("Stream closed without acknowledgment");
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, "Failed to receive acknowledgment");
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        retry = retries + 1,
                        max_retries = self.config.max_retries,
                        "Failed to send batch"
                    );
                }
            }

            retries += 1;
            if retries >= self.config.max_retries {
                tracing::error!(
                    batch_size = batch_size,
                    "Failed to send batch after max retries"
                );
                *self.is_healthy.write().await = false;
                return;
            }

            tokio::time::sleep(Duration::from_millis(self.config.retry_delay_ms)).await;
        }
    }

    /// Run periodic health checks
    async fn run_health_checks(&self) {
        let mut interval = tokio::time::interval(Duration::from_secs(30));

        loop {
            interval.tick().await;

            let ping = PingRequest {
                client_timestamp_ms: Instant::now().elapsed().as_millis() as u64,
                client_version: env!("CARGO_PKG_VERSION").to_string(),
            };

            let mut client = self.client.write().await;

            match client.ping(Request::new(ping)).await {
                Ok(response) => {
                    let pong = response.into_inner();

                    *self.last_health_check.write().await = Instant::now();
                    *self.is_healthy.write().await =
                        pong.health == proto::pong_response::ServerHealth::Operational as i32;

                    tracing::debug!("Health check passed");
                }
                Err(e) => {
                    tracing::warn!(error = %e, "Health check failed");
                    *self.is_healthy.write().await = false;
                }
            }
        }
    }

    /// Send a single signed event
    pub async fn send_event(&self, event: SignedUsageEvent) -> Result<()> {
        self.event_tx
            .send(event)
            .await
            .map_err(|_| Error::Internal("Event channel closed".to_string()))
    }

    /// Send a signed batch
    pub async fn send_batch(&self, batch: SignedBatch) -> Result<()> {
        for event in batch.events {
            self.event_tx
                .send(event)
                .await
                .map_err(|_| Error::Internal("Event channel closed".to_string()))?;
        }
        Ok(())
    }

    /// Request settlement for a provider
    pub async fn request_settlement(
        &self,
        provider_id: String,
        amount_lamports: u64,
    ) -> Result<SettlementResponse> {
        let _timer = metrics::BLOCKCHAIN_LATENCY.start_timer();

        let request = SettlementRequest {
            provider_id,
            total_bytes: 0, // Calculated on-chain
            amount_lamports,
            oracle_signature: vec![], // Added by settlement service
            event_hashes: vec![],
            period_start_ms: 0,
            period_end_ms: 0,
            rate_usd_per_gb: 0.0,
        };

        let mut client = self.client.write().await;

        let request_stream = tokio_stream::iter(vec![request]);
        let response = client
            .settle_provider(Request::new(request_stream))
            .await
            .map_err(|e| Error::BlockchainConnection(format!("Settlement failed: {}", e)))?;

        let mut stream = response.into_inner();

        match stream.message().await {
            Ok(Some(proto_response)) => {
                metrics::BLOCKCHAIN_SETTLEMENTS.inc();

                Ok(SettlementResponse {
                    transaction_signature: proto_response.transaction_signature,
                    slot: proto_response.slot,
                    block_height: proto_response.block_height,
                    confirmations: proto_response.confirmations,
                    status: match proto_response.status {
                        x if x == proto::settlement_response::Status::Pending as i32 => {
                            SettlementStatus::Pending
                        }
                        x if x == proto::settlement_response::Status::Confirmed as i32 => {
                            SettlementStatus::Confirmed
                        }
                        x if x == proto::settlement_response::Status::Failed as i32 => {
                            SettlementStatus::Failed
                        }
                        x if x == proto::settlement_response::Status::Expired as i32 => {
                            SettlementStatus::Expired
                        }
                        _ => SettlementStatus::Failed,
                    },
                    error_message: if proto_response.error_message.is_empty() {
                        None
                    } else {
                        Some(proto_response.error_message)
                    },
                    confirmed_at_ms: proto_response.confirmed_at_ms,
                    actual_amount_lamports: proto_response.actual_amount_lamports,
                })
            }
            Ok(None) => Err(Error::Internal(
                "No settlement response received".to_string(),
            )),
            Err(e) => Err(Error::BlockchainConnection(format!("Stream error: {}", e))),
        }
    }

    /// Get current pricing from blockchain oracle
    pub async fn get_pricing(&self) -> Result<PricingResponse> {
        let _timer = metrics::BLOCKCHAIN_LATENCY.start_timer();

        let request = PricingRequest {
            provider_id: String::new(),
            region: String::new(),
        };

        let mut client = self.client.write().await;

        let response = client
            .get_current_pricing(Request::new(request))
            .await
            .map_err(|e| Error::BlockchainConnection(format!("Pricing request failed: {}", e)))?;

        let proto = response.into_inner();

        Ok(PricingResponse {
            base_rate_usd_per_gb: proto.base_rate_usd_per_gb,
            demand_multiplier: proto.demand_multiplier,
            sol_price_usd: proto.sol_price_usd,
            effective_rate_usd_per_gb: proto.effective_rate_usd_per_gb,
            effective_rate_sol_per_gb: proto.effective_rate_sol_per_gb,
            timestamp_ms: proto.timestamp_ms,
            valid_until_ms: proto.valid_until_ms,
        })
    }

    /// Check if the stream is healthy
    pub async fn is_healthy(&self) -> bool {
        *self.is_healthy.read().await
    }

    /// Get connection statistics
    pub async fn stats(&self) -> StreamStats {
        StreamStats {
            endpoint: self.endpoint.clone(),
            connected_at: self.connected_at,
            uptime_seconds: self.connected_at.elapsed().as_secs(),
            events_sent: *self.events_sent.read().await,
            is_healthy: *self.is_healthy.read().await,
        }
    }
}

/// Stream statistics for monitoring
#[derive(Debug, Clone)]
pub struct StreamStats {
    pub endpoint: String,
    pub connected_at: Instant,
    pub uptime_seconds: u64,
    pub events_sent: u64,
    pub is_healthy: bool,
}
