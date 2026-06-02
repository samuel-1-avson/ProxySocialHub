//! QUIC provider tunnel listener (P4.3 placeholder).
//!
//! Real quinn integration will listen on `TUNNEL_PORT` (or a dedicated QUIC port) and
//! feed the same registry attach path as yamux. Until then, providers use TCP+yamux.

use crate::config::Config;
use std::sync::Arc;
use crate::state::AppState;

/// No-op when the `quic` feature is enabled but the listener is not implemented yet.
pub async fn spawn_quic_tunnel_listener(
    _config: Arc<Config>,
    _state: Arc<AppState>,
) -> anyhow::Result<()> {
    tracing::info!(
        "QUIC provider transport is compiled but not listening yet; use yamux on TUNNEL_PORT"
    );
    Ok(())
}
