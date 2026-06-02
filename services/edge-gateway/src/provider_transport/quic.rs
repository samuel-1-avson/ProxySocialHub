//! QUIC provider transport (P4.2+).
//!
//! Enable with `cargo build --features quic`. Until the quinn listener lands,
//! `PROVIDER_TRANSPORT=quic` only affects startup logging; providers still use
//! yamux on `TUNNEL_PORT`.

#[cfg(feature = "quic")]
pub fn log_transport_status() {
    tracing::info!(
        "PROVIDER_TRANSPORT=quic: quic feature enabled; yamux/TCP on TUNNEL_PORT remains the active provider path until quinn listener ships"
    );
}

#[cfg(not(feature = "quic"))]
pub fn log_transport_status() {
    tracing::warn!(
        "PROVIDER_TRANSPORT=quic but edge-gateway was built without --features quic; using yamux/TCP on TUNNEL_PORT"
    );
}
