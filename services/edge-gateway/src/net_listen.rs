//! TCP listen helpers (Linux `SO_REUSEPORT` for horizontal accept scaling).

use std::io;
use std::net::SocketAddr;

use tokio::net::{TcpListener, TcpSocket};
use tracing::info;

/// Number of parallel accept loops on the buyer port (`BUYER_ACCEPT_WORKERS`, default 1).
pub fn buyer_accept_workers() -> usize {
    let n = std::env::var("BUYER_ACCEPT_WORKERS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(1);
    n.max(1)
}

/// Bind one or more listeners on `addr`. With `BUYER_ACCEPT_WORKERS` > 1 on Unix, each socket uses `SO_REUSEPORT`.
pub async fn bind_buyer_listeners(addr: SocketAddr) -> io::Result<Vec<TcpListener>> {
    #[cfg(not(unix))]
    let workers = 1usize;
    #[cfg(unix)]
    let workers = buyer_accept_workers();

    if workers == 1 {
        return Ok(vec![TcpListener::bind(addr).await?]);
    }

    let mut listeners = Vec::with_capacity(workers);
    for _ in 0..workers {
        let socket = match addr {
            SocketAddr::V4(_) => TcpSocket::new_v4()?,
            SocketAddr::V6(_) => TcpSocket::new_v6()?,
        };
        if let Err(e) = socket.set_reuseaddr(true) {
            tracing::warn!("set_reuseaddr: {e}");
        }
        #[cfg(all(unix, not(target_os = "solaris")))]
        if let Err(e) = socket.set_reuseport(true) {
            tracing::warn!("set_reuseport: {e}");
        }
        socket.bind(addr)?;
        listeners.push(socket.listen(8192)?);
    }
    info!(
        %addr,
        workers,
        "Buyer port bound with SO_REUSEPORT accept pool"
    );
    Ok(listeners)
}
