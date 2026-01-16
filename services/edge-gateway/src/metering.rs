use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{interval, Duration};

/// Tracks usage per session and periodically reports to Control API
pub struct UsageTracker {
    // Session username -> (bytes_up, bytes_down)
    usage: Arc<RwLock<HashMap<String, (u64, u64)>>>,
    control_api_url: String,
}

impl UsageTracker {
    pub fn new(control_api_url: &str) -> Self {
        Self {
            usage: Arc::new(RwLock::new(HashMap::new())),
            control_api_url: control_api_url.to_string(),
        }
    }

    /// Record usage for a session
    pub async fn record(&self, session_username: &str, bytes_up: u64, bytes_down: u64) {
        let mut usage = self.usage.write().await;
        let entry = usage.entry(session_username.to_string()).or_insert((0, 0));
        entry.0 += bytes_up;
        entry.1 += bytes_down;
    }

    /// Start background task that flushes usage every 30 seconds
    pub fn start_flush_task(self: Arc<Self>) {
        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(30));
            
            loop {
                ticker.tick().await;
                self.flush().await;
            }
        });
    }

    /// Flush accumulated usage to Control API
    async fn flush(&self) {
        let reports: Vec<UsageReport>;
        
        // Swap out the current usage data
        {
            let mut usage = self.usage.write().await;
            reports = usage.drain()
                .map(|(username, (up, down))| UsageReport {
                    session_username: username,
                    bytes_up: up as i64,
                    bytes_down: down as i64,
                })
                .collect();
        }

        if reports.is_empty() {
            return;
        }

        // Send to Control API
        let client = reqwest::Client::new();
        let url = format!("{}/v1/usage/report", self.control_api_url);
        
        let payload = BatchUsageReport { reports };
        
        match client.post(&url)
            .json(&payload)
            .send()
            .await
        {
            Ok(response) => {
                if response.status().is_success() {
                    println!("[Metering] Flushed {} usage reports", payload.reports.len());
                } else {
                    eprintln!("[Metering] Failed to report usage: {}", response.status());
                }
            }
            Err(e) => {
                eprintln!("[Metering] Failed to connect to Control API: {}", e);
            }
        }
    }
}

#[derive(serde::Serialize)]
struct UsageReport {
    session_username: String,
    bytes_up: i64,
    bytes_down: i64,
}

#[derive(serde::Serialize)]
struct BatchUsageReport {
    reports: Vec<UsageReport>,
}
