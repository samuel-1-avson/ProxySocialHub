//! P4 — Provider transport selection and yamux multiplexing.
//!
//! Today providers connect over TCP + yamux (`TUNNEL_PORT`). Multiple parallel
//! yamux sessions per node shard buyer streams across connections (see
//! `YAMUX_CONNS_PER_NODE`). QUIC provider ingress: `--features quic` + `PROVIDER_TRANSPORT=quic`.

pub mod quic;
#[cfg(feature = "quic")]
pub mod quic_listener;
pub mod yamux_mux;

use std::env;

/// Wire transport for provider ↔ gateway (ingress path is unchanged).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderTransportKind {
    Yamux,
    Quic,
}

impl ProviderTransportKind {
    pub fn from_env() -> Self {
        match env::var("PROVIDER_TRANSPORT")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "quic" | "http3" => Self::Quic,
            _ => Self::Yamux,
        }
    }

    /// Whether the running binary can serve QUIC provider connections.
    pub fn quic_compiled(&self) -> bool {
        matches!(self, Self::Quic) && cfg!(feature = "quic")
    }
}

/// `YAMUX_CONNS_PER_NODE` — parallel yamux/TCP sessions per registered provider (1–16).
pub fn yamux_conns_per_node_from_env() -> usize {
    const DEFAULT: usize = 1;
    const MAX: usize = 16;
    let raw = env::var("YAMUX_CONNS_PER_NODE").unwrap_or_else(|_| DEFAULT.to_string());
    match raw.trim().parse::<usize>() {
        Ok(0) => DEFAULT,
        Ok(n) => n.min(MAX).max(1),
        Err(_) => {
            tracing::warn!(
                raw = %raw,
                "Invalid YAMUX_CONNS_PER_NODE; using default {DEFAULT}"
            );
            DEFAULT
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_transport_kind_from_env_defaults_yamux() {
        std::env::remove_var("PROVIDER_TRANSPORT");
        assert_eq!(
            ProviderTransportKind::from_env(),
            ProviderTransportKind::Yamux
        );
    }
}
