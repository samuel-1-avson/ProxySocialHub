//! QUIC provider transport (P4.2+).
//!
//! Enable with `cargo build --features quic`. Until the quinn listener lands,
//! `PROVIDER_TRANSPORT=quic` only affects startup logging; providers still use
//! yamux on `TUNNEL_PORT`.

#[cfg(feature = "quic")]
pub fn log_transport_status() {
    tracing::info!(
        "PROVIDER_TRANSPORT=quic: listening on UDP TUNNEL_PORT (yamux on first QUIC bidi stream); provider-node uses open_bi + --features quic"
    );
}

#[cfg(not(feature = "quic"))]
pub fn log_transport_status() {
    tracing::warn!(
        "PROVIDER_TRANSPORT=quic but edge-gateway was built without --features quic; using yamux/TCP on TUNNEL_PORT"
    );
}
