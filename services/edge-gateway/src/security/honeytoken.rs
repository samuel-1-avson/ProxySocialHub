//! Honeytokens — decoy destinations used to trap and identify malicious actors.
//!
//! A honeytoken is a domain or IP address that no legitimate client should ever access.
//! When a client's CONNECT request matches a honeytoken, they are immediately flagged.

use dashmap::DashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HoneytokenType {
    /// A domain name that looks sensitive but contains no real data (e.g., "internal-vault.phub.io").
    DecoyDomain,
    /// A sensitive cloud metadata endpoint (e.g., "169.254.169.254").
    SensitiveEndpoint,
    /// A known "forbidden" internal IP range.
    InternalIP,
}

pub struct HoneytokenRegistry {
    /// Map of target address (domain or IP) to its decoy type.
    tokens: DashMap<String, HoneytokenType>,
}

impl HoneytokenRegistry {
    pub fn new() -> Self {
        let tokens = DashMap::new();

        // Default honeytokens (standard decoys)
        tokens.insert(
            "metadata.google.internal".to_string(),
            HoneytokenType::SensitiveEndpoint,
        );
        tokens.insert(
            "169.254.169.254".to_string(),
            HoneytokenType::SensitiveEndpoint,
        );
        tokens.insert(
            "vault.internal.proxyhubb.io".to_string(),
            HoneytokenType::DecoyDomain,
        );
        tokens.insert(
            "admin-console.internal".to_string(),
            HoneytokenType::DecoyDomain,
        );

        Self { tokens }
    }

    /// Check if the given address (host:port or host) is a registered honeytoken.
    pub fn check(&self, target: &str) -> Option<HoneytokenType> {
        // Extract host if it's host:port
        let host = target.split(':').next().unwrap_or(target);
        self.tokens.get(host).map(|v| *v)
    }

    /// Add a new honeytoken at runtime.
    pub fn add_token(&self, target: String, token_type: HoneytokenType) {
        self.tokens.insert(target, token_type);
    }
}

impl Default for HoneytokenRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_matches_host_and_strips_port() {
        let reg = HoneytokenRegistry::new();
        assert_eq!(
            reg.check("169.254.169.254"),
            Some(HoneytokenType::SensitiveEndpoint)
        );
        assert_eq!(
            reg.check("169.254.169.254:80"),
            Some(HoneytokenType::SensitiveEndpoint)
        );
        assert_eq!(reg.check("example.com"), None);
    }
}

/// A "sink" for malicious connections. Emits data that confuses scrapers.
pub mod sink {
    use std::io;
    use tokio::io::{repeat, AsyncWriteExt};

    /// Consumes all input and provides an infinite stream of random-looking data
    /// or "slow-roll" response to waste the attacker's time.
    pub async fn handle_malicious_connection(
        mut stream: tokio::io::DuplexStream,
    ) -> io::Result<()> {
        let mut sink = tokio::io::sink();
        let mut source = repeat(0xCC); // "Trap" pattern

        // Concurrent read (drain attacker) and write (slow trap)
        let (mut req_rx, mut req_tx) = tokio::io::split(stream);

        let reader = async move { tokio::io::copy(&mut req_rx, &mut sink).await };

        let writer = async move {
            // Send decoy header to make it look like a real (but broken) backend
            let _ = req_tx
                .write_all(b"HTTP/1.1 200 OK\r\nServer: Nginx\r\nContent-Type: text/plain\r\n\r\n")
                .await;
            tokio::io::copy(&mut source, &mut req_tx).await
        };

        tokio::select! {
            res = reader => res.map(|_| ()),
            res = writer => res.map(|_| ()),
        }
    }
}
