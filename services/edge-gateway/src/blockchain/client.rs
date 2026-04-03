//! P2-A9: Solana RPC Client
//!
//! Direct Solana RPC client for blockchain interactions.
//! Complements the gRPC streaming for queries and transactions.

use super::BlockchainConfig;
use crate::error::{Error, Result};

use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Solana RPC client for direct blockchain queries
pub struct SolanaClient {
    /// HTTP client for RPC calls
    http_client: Client,

    /// RPC endpoint URL
    endpoint: Url,

    /// Fallback endpoints
    fallback_endpoints: Vec<Url>,

    /// Request timeout
    timeout: Duration,
}

/// Solana RPC response wrapper
#[derive(Debug, Deserialize)]
struct RpcResponse<T> {
    jsonrpc: String,
    result: Option<T>,
    error: Option<RpcError>,
    id: u64,
}

/// Solana RPC error
#[derive(Debug, Deserialize)]
struct RpcError {
    code: i64,
    message: String,
}

/// Account info response
#[derive(Debug, Deserialize)]
struct AccountInfo {
    lamports: u64,
    owner: String,
    executable: bool,
    rent_epoch: u64,
    data: Vec<String>, // [data, encoding]
}

/// Blockhash response
#[derive(Debug, Deserialize)]
struct BlockhashResponse {
    blockhash: String,
    last_valid_block_height: u64,
}

/// Balance response
#[derive(Debug, Deserialize)]
struct BalanceResponse {
    value: u64,
}

/// Signature status
#[derive(Debug, Deserialize)]
struct SignatureStatus {
    slot: u64,
    confirmations: Option<u64>,
    err: Option<serde_json::Value>,
    confirmation_status: Option<String>,
}

impl SolanaClient {
    /// Create a new Solana client
    pub async fn new(config: &BlockchainConfig) -> Result<Self> {
        let http_client = Client::builder()
            .timeout(Duration::from_secs(30))
            .pool_max_idle_per_host(10)
            .build()
            .map_err(|e| Error::Internal(format!("Failed to create HTTP client: {}", e)))?;

        let endpoint = Url::parse(&config.primary_endpoint)
            .map_err(|e| Error::Configuration(format!("Invalid endpoint URL: {}", e)))?;

        let fallback_endpoints: Vec<Url> = config
            .fallback_endpoints
            .iter()
            .filter_map(|e| Url::parse(e).ok())
            .collect();

        let client = Self {
            http_client,
            endpoint,
            fallback_endpoints,
            timeout: Duration::from_secs(30),
        };

        // Test connection
        match client.get_health().await {
            Ok(health) => {
                tracing::info!(
                    endpoint = %client.endpoint,
                    health = %health,
                    "Solana RPC client initialized"
                );
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "Failed to verify Solana health, proceeding anyway"
                );
            }
        }

        Ok(client)
    }

    /// Make an RPC call with retry logic
    async fn rpc_call<T: for<'de> Deserialize<'de> + std::fmt::Debug>(
        &self,
        method: &str,
        params: Vec<serde_json::Value>,
    ) -> Result<T> {
        let request_body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        });

        // Try primary endpoint
        let result = self.rpc_call_single(&self.endpoint, &request_body).await;

        if result.is_ok() {
            return result;
        }

        // Try fallback endpoints
        for fallback in &self.fallback_endpoints {
            tracing::warn!(
                fallback = %fallback,
                "Primary RPC failed, trying fallback"
            );

            match self.rpc_call_single(fallback, &request_body).await {
                Ok(result) => return Ok(result),
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        fallback = %fallback,
                        "Fallback RPC also failed"
                    );
                }
            }
        }

        // All endpoints failed
        Err(result.unwrap_err())
    }

    /// Make RPC call to a single endpoint
    async fn rpc_call_single<T: for<'de> Deserialize<'de>>(
        &self,
        endpoint: &Url,
        request_body: &serde_json::Value,
    ) -> Result<T> {
        let response = self
            .http_client
            .post(endpoint.clone())
            .json(request_body)
            .send()
            .await
            .map_err(|e| Error::BlockchainConnection(format!("HTTP error: {}", e)))?;

        let rpc_response: RpcResponse<T> = response
            .json()
            .await
            .map_err(|e| Error::BlockchainConnection(format!("JSON parse error: {}", e)))?;

        if let Some(error) = rpc_response.error {
            return Err(Error::BlockchainConnection(format!(
                "RPC error {}: {}",
                error.code, error.message
            )));
        }

        rpc_response
            .result
            .ok_or_else(|| Error::BlockchainConnection("No result in RPC response".to_string()))
    }

    /// Get cluster health status
    pub async fn get_health(&self) -> Result<String> {
        #[derive(Debug, Deserialize)]
        struct HealthResponse {
            status: String,
        }

        let health: HealthResponse = self.rpc_call("getHealth", vec![]).await?;
        Ok(health.status)
    }

    /// Get account balance in lamports
    pub async fn get_balance(&self, pubkey: &str) -> Result<u64> {
        let balance: BalanceResponse = self
            .rpc_call("getBalance", vec![serde_json::json!(pubkey)])
            .await?;
        Ok(balance.value)
    }

    /// Get recent blockhash for transactions
    pub async fn get_recent_blockhash(&self) -> Result<BlockhashResponse> {
        #[derive(Debug, Deserialize)]
        struct BlockhashResult {
            context: serde_json::Value,
            value: BlockhashResponse,
        }

        let result: BlockhashResult = self
            .rpc_call(
                "getLatestBlockhash",
                vec![serde_json::json!({"commitment": "confirmed"})],
            )
            .await?;
        Ok(result.value)
    }

    /// Get account information
    pub async fn get_account_info(&self, pubkey: &str) -> Result<Option<AccountInfo>> {
        #[derive(Debug, Deserialize)]
        struct AccountResult {
            context: serde_json::Value,
            value: Option<AccountInfo>,
        }

        let result: AccountResult = self
            .rpc_call(
                "getAccountInfo",
                vec![
                    serde_json::json!(pubkey),
                    serde_json::json!({"encoding": "base64"}),
                ],
            )
            .await?;
        Ok(result.value)
    }

    /// Get transaction signature status
    pub async fn get_signature_statuses(
        &self,
        signatures: &[String],
    ) -> Result<Vec<Option<SignatureStatus>>> {
        #[derive(Debug, Deserialize)]
        struct StatusesResult {
            context: serde_json::Value,
            value: Vec<Option<SignatureStatus>>,
        }

        let result: StatusesResult = self
            .rpc_call(
                "getSignatureStatuses",
                vec![
                    serde_json::json!(signatures),
                    serde_json::json!({"searchTransactionHistory": true}),
                ],
            )
            .await?;
        Ok(result.value)
    }

    /// Wait for transaction confirmation
    pub async fn wait_for_confirmation(&self, signature: &str, timeout_secs: u64) -> Result<bool> {
        let start = std::time::Instant::now();
        let timeout = Duration::from_secs(timeout_secs);

        while start.elapsed() < timeout {
            let statuses = self
                .get_signature_statuses(&[signature.to_string()])
                .await?;

            if let Some(Some(status)) = statuses.first() {
                match status.confirmation_status.as_deref() {
                    Some("confirmed") | Some("finalized") => {
                        return Ok(true);
                    }
                    _ => {
                        if status.err.is_some() {
                            return Err(Error::BlockchainConnection(
                                "Transaction failed".to_string(),
                            ));
                        }
                    }
                }
            }

            tokio::time::sleep(Duration::from_millis(500)).await;
        }

        Ok(false) // Timeout
    }

    /// Get current slot
    pub async fn get_slot(&self) -> Result<u64> {
        self.rpc_call("getSlot", vec![]).await
    }

    /// Get block height
    pub async fn get_block_height(&self) -> Result<u64> {
        self.rpc_call("getBlockHeight", vec![]).await
    }

    /// Get epoch info
    pub async fn get_epoch_info(&self) -> Result<EpochInfo> {
        self.rpc_call("getEpochInfo", vec![]).await
    }

    /// Get minimum balance for rent exemption
    pub async fn get_minimum_balance_for_rent_exemption(&self, data_size: usize) -> Result<u64> {
        self.rpc_call(
            "getMinimumBalanceForRentExemption",
            vec![serde_json::json!(data_size)],
        )
        .await
    }

    /// Send a raw transaction
    pub async fn send_transaction(&self, encoded_transaction: &str) -> Result<String> {
        #[derive(Debug, Deserialize)]
        struct SendResult {
            #[serde(rename = "result")]
            signature: String,
        }

        let result: SendResult = self
            .rpc_call(
                "sendTransaction",
                vec![
                    serde_json::json!(encoded_transaction),
                    serde_json::json!({
                        "encoding": "base64",
                        "preflightCommitment": "confirmed",
                        "maxRetries": 3,
                    }),
                ],
            )
            .await?;
        Ok(result.signature)
    }

    /// Get program accounts
    pub async fn get_program_accounts(
        &self,
        program_id: &str,
        filters: Vec<ProgramAccountFilter>,
    ) -> Result<Vec<ProgramAccount>> {
        let mut params = vec![serde_json::json!(program_id)];

        if !filters.is_empty() {
            let config = serde_json::json!({
                "encoding": "base64",
                "filters": filters,
            });
            params.push(config);
        }

        self.rpc_call("getProgramAccounts", params).await
    }
}

/// Epoch information
#[derive(Debug, Deserialize)]
pub struct EpochInfo {
    pub epoch: u64,
    pub slot_index: u64,
    pub slots_in_epoch: u64,
    pub absolute_slot: u64,
    pub block_height: u64,
    pub transaction_count: Option<u64>,
}

/// Program account filter
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ProgramAccountFilter {
    DataSize { data_size: u64 },
    Memcmp { memcmp: MemcmpFilter },
}

/// Memcmp filter
#[derive(Debug, Serialize)]
pub struct MemcmpFilter {
    pub offset: u64,
    pub bytes: String,
}

/// Program account response
#[derive(Debug, Deserialize)]
pub struct ProgramAccount {
    pub pubkey: String,
    pub account: AccountData,
}

/// Account data
#[derive(Debug, Deserialize)]
pub struct AccountData {
    pub lamports: u64,
    pub owner: String,
    pub executable: bool,
    pub rent_epoch: u64,
    pub data: Vec<String>,
}

/// Client metrics
pub mod metrics {
    use lazy_static::lazy_static;
    use prometheus::{Histogram, IntCounter, IntGauge};

    lazy_static! {
        pub static ref RPC_CALLS_TOTAL: IntCounter = prometheus::register_int_counter!(
            "edge_gateway_solana_rpc_calls_total",
            "Total Solana RPC calls made"
        )
        .unwrap();
        pub static ref RPC_ERRORS_TOTAL: IntCounter = prometheus::register_int_counter!(
            "edge_gateway_solana_rpc_errors_total",
            "Total Solana RPC call errors"
        )
        .unwrap();
        pub static ref RPC_LATENCY: Histogram = prometheus::register_histogram!(
            "edge_gateway_solana_rpc_latency_seconds",
            "Solana RPC call latency",
            prometheus::exponential_buckets(0.001, 2.0, 15).unwrap()
        )
        .unwrap();
        pub static ref FALLBACK_USED: IntCounter = prometheus::register_int_counter!(
            "edge_gateway_solana_fallback_used_total",
            "Times fallback RPC endpoint was used"
        )
        .unwrap();
        pub static ref CURRENT_SLOT: IntGauge = prometheus::register_int_gauge!(
            "edge_gateway_solana_current_slot",
            "Current Solana slot"
        )
        .unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // These tests require a live Solana node or mock server
    // They are marked as ignore for CI/CD

    #[tokio::test]
    #[ignore]
    async fn test_get_health() {
        let config = BlockchainConfig::default();
        let client = SolanaClient::new(&config).await.unwrap();

        let health = client.get_health().await.unwrap();
        assert!(!health.is_empty());
    }

    #[tokio::test]
    #[ignore]
    async fn test_get_slot() {
        let config = BlockchainConfig::default();
        let client = SolanaClient::new(&config).await.unwrap();

        let slot = client.get_slot().await.unwrap();
        assert!(slot > 0);
    }
}
