//! QUIC dialer for the provider tunnel (yamux on first client-initiated bidi stream).

use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use crate::config::Config;
use crate::tunnel::client::{build_rustls_client_config, extract_host};

use anyhow::{Context as _, Result};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tracing::debug;

/// Dial the gateway over QUIC+TLS and return a single bidirectional byte stream for yamux.
pub async fn dial_quic_bidi(config: &Config) -> Result<QuinnBidiStream> {
    if !config.use_tls && !config.tls_skip_verify {
        anyhow::bail!(
            "PROVIDER_TRANSPORT=quic requires TLS (--use-tls or use_tls=true); gateway QUIC listener uses TLS"
        );
    }

    let server_addr = resolve_gateway_socket(&config.gateway_addr).await?;
    let server_name = extract_host(&config.gateway_addr);

    let rustls_config = build_rustls_client_config(config)?;
    let quic_crypto = quinn::crypto::rustls::QuicClientConfig::try_from(rustls_config)
        .map_err(|e| anyhow::anyhow!("QUIC TLS client config: {e}"))?;
    let client_config = quinn::ClientConfig::new(Arc::new(quic_crypto));

    let bind: SocketAddr = "0.0.0.0:0".parse().expect("valid bind addr");
    let mut endpoint = quinn::Endpoint::client(bind)
        .map_err(|e| anyhow::anyhow!("QUIC client endpoint: {e}"))?;
    endpoint.set_default_client_config(client_config);

    debug!(%server_addr, %server_name, "QUIC connecting to gateway");
    let conn = endpoint
        .connect(server_addr, server_name.as_str())?
        .await
        .with_context(|| format!("QUIC connect to {server_addr} failed"))?;

    let (send, recv) = conn
        .open_bi()
        .await
        .context("QUIC open_bi for yamux tunnel")?;

    debug!(%server_addr, "QUIC bidi stream open (yamux)");
    Ok(QuinnBidiStream {
        _endpoint: endpoint,
        send,
        recv,
    })
}

async fn resolve_gateway_socket(addr: &str) -> Result<SocketAddr> {
    let mut addrs = tokio::net::lookup_host(addr)
        .await
        .with_context(|| format!("resolve gateway address {addr}"))?;
    addrs
        .next()
        .ok_or_else(|| anyhow::anyhow!("no addresses for gateway {addr}"))
}

/// Join QUIC send/recv into one Tokio `AsyncRead + AsyncWrite` for `tokio_util::compat`.
pub struct QuinnBidiStream {
    /// Held for the lifetime of the QUIC connection (dropping closes the socket).
    _endpoint: quinn::Endpoint,
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
