//! QUIC provider tunnel listener (P4.3).
//!
//! Listens on UDP `TUNNEL_PORT` (same numeric port as TCP yamux, different protocol).
//! Each accepted QUIC connection uses the first client-initiated bidirectional stream
//! as the yamux byte pipe, then runs the same AUTH/CAPABILITY handshake as `tunnel.rs`.
//!
//! **Provider client:** `provider-node` with `PROVIDER_TRANSPORT=quic` and `--features quic`
//! dials UDP, `open_bi`, then yamux (this listener `accept_bi`).

use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use crate::config::Config;
use crate::state::AppState;
use crate::tls::{create_provider_quic_server_config, is_tls_enabled, TlsConfig};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tracing::{debug, error, info, warn};

/// Run the QUIC provider tunnel accept loop until the endpoint is closed.
pub async fn spawn_quic_tunnel_listener(
    config: Arc<Config>,
    state: Arc<AppState>,
) -> anyhow::Result<()> {
    let tls_config = TlsConfig::from_env().ok_or_else(|| {
        anyhow::anyhow!(
            "PROVIDER_TRANSPORT=quic requires TLS_CERT_PATH/TLS_KEY_PATH (or TLS_CERT_FILE/TLS_KEY_FILE) for the provider tunnel"
        )
    })?;
    if !is_tls_enabled() {
        warn!("TLS env vars present but is_tls_enabled() is false; continuing with parsed paths");
    }

    let server_config = create_provider_quic_server_config(&tls_config)
        .map_err(|e| anyhow::anyhow!("provider QUIC TLS init failed: {e}"))?;

    let addr = SocketAddr::from(([0, 0, 0, 0], config.tunnel_port));
    let endpoint = quinn::Endpoint::server(server_config, addr)?;
    info!(
        %addr,
        "Provider QUIC tunnel listening (yamux on first bidi stream; same AUTH/CAPABILITY as TCP)"
    );

    while let Some(incoming) = endpoint.accept().await {
        let state = state.clone();
        tokio::spawn(async move {
            match incoming.await {
                Ok(conn) => {
                    let peer = conn.remote_address();
                    if let Err(e) = serve_provider_quic_connection(conn, peer, state).await {
                        debug!(%peer, error = %e, "provider QUIC connection ended");
                    }
                }
                Err(e) => error!(error = %e, "provider QUIC accept failed"),
            }
        });
    }

    Ok(())
}

async fn serve_provider_quic_connection(
    conn: quinn::Connection,
    peer_addr: SocketAddr,
    state: Arc<AppState>,
) -> anyhow::Result<()> {
    if crate::pod_drain::is_draining(&state) {
        conn.close(0u32.into(), b"draining");
        return Ok(());
    }

    let (send, recv) = match conn.accept_bi().await {
        Ok(streams) => streams,
        Err(e) => {
            anyhow::bail!("provider QUIC bidi stream accept: {e}");
        }
    };

    let io = QuinnBidiStream { send, recv };
    crate::tunnel::handle_provider_mux_io(io, peer_addr, state).await;
    Ok(())
}

/// Join a QUIC bidirectional stream pair into one Tokio `AsyncRead + AsyncWrite`.
struct QuinnBidiStream {
    send: quinn::SendStream,
    recv: quinn::RecvStream,
}

impl AsyncRead for QuinnBidiStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.recv).poll_read(cx, buf)
    }
}

impl AsyncWrite for QuinnBidiStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        match Pin::new(&mut self.send).poll_write(cx, buf) {
            Poll::Ready(Ok(n)) => Poll::Ready(Ok(n)),
            Poll::Ready(Err(e)) => Poll::Ready(Err(std::io::Error::other(e))),
            Poll::Pending => Poll::Pending,
        }
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match Pin::new(&mut self.send).poll_flush(cx) {
            Poll::Ready(Ok(())) => Poll::Ready(Ok(())),
            Poll::Ready(Err(e)) => Poll::Ready(Err(std::io::Error::other(e))),
            Poll::Pending => Poll::Pending,
        }
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match Pin::new(&mut self.send).poll_shutdown(cx) {
            Poll::Ready(Ok(())) => Poll::Ready(Ok(())),
            Poll::Ready(Err(e)) => Poll::Ready(Err(std::io::Error::other(e))),
            Poll::Pending => Poll::Pending,
        }
    }
}
