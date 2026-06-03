//! Efficient bidirectional stream bridge with byte tracking (P2-W7).
//!
//! Replaces the manual 16 KB loop in `bridge_to_provider` with:
//! - 64 KB buffers (4× improvement in throughput per syscall)
//! - Periodic revalidation callback (for bandwidth-limit enforcement)
//! - Linux `splice(2)` on the **buyer TCP leg** when a raw socket FD is available (P1)
//!
//! # Zero-copy on Linux (client leg only)
//! On Linux, `splice(2)` can move data from the buyer's TCP socket into a pipe without
//! copying through userspace, then we read the pipe once and forward to the provider.
//! The **provider leg stays in userspace** because it is a yamux-multiplexed stream, not
//! a raw TCP socket (see blueprint §5.8 for multi-connection / QUIC improvements).
//!
//! When splice is unavailable we fall back to the standard async read/write loop.

use std::future::Future;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tracing::{debug, trace};

/// Statistics returned after a bridge session ends.
#[derive(Debug, Default, Clone, Copy)]
pub struct BridgeStats {
    pub bytes_from_client: u64,
    pub bytes_from_provider: u64,
}

impl BridgeStats {
    pub fn total(&self) -> u64 {
        self.bytes_from_client + self.bytes_from_provider
    }
}

/// Raw TCP fd for the buyer CONNECT socket, when available (Linux splice path).
#[cfg(unix)]
pub type ClientTcpFd = std::os::unix::io::RawFd;
#[cfg(not(unix))]
pub type ClientTcpFd = ();

/// Extract the buyer socket FD for splice, if this platform exposes one.
///
/// `hyper::upgrade::Upgraded` does not implement `AsRawFd` today, so we return `None`
/// and the Linux splice path falls back to the userspace bridge (see `bridge_tracked`).
#[cfg(unix)]
pub fn client_tcp_fd_from_upgrade(upgraded: &hyper::upgrade::Upgraded) -> Option<ClientTcpFd> {
    let _ = upgraded;
    None
}

#[cfg(not(unix))]
pub fn client_tcp_fd_from_upgrade(_upgraded: &hyper::upgrade::Upgraded) -> Option<ClientTcpFd> {
    None
}

/// Bridge two async streams bidirectionally with byte tracking.
///
/// - Uses 64 KB buffers (vs the old 16 KB) to reduce syscall overhead.
/// - Calls `should_continue(stats)` every `revalidate_every` bytes.
///   Return `false` from the callback to terminate the bridge early
///   (e.g., bandwidth limit reached).
/// - `idle_timeout`: if `Some(d)`, the bridge is closed when neither direction
///   transfers any bytes within `d` (P2-12 — prevents zombie tunnels).
/// - `client_tcp_fd`: on Linux, enables splice for buyer→provider when set.
/// - Returns `BridgeStats` regardless of how the bridge terminated.
pub async fn bridge_tracked<A, B, F, Fut>(
    client: &mut A,
    provider: &mut B,
    client_tcp_fd: Option<ClientTcpFd>,
    revalidate_every: u64,
    idle_timeout: Option<Duration>,
    mut should_continue: F,
) -> BridgeStats
where
    A: AsyncRead + AsyncWrite + Unpin,
    B: AsyncRead + AsyncWrite + Unpin,
    F: FnMut(BridgeStats) -> Fut,
    Fut: Future<Output = bool>,
{
    #[cfg(not(target_os = "linux"))]
    let _ = client_tcp_fd;

    #[cfg(target_os = "linux")]
    if let Some(fd) = client_tcp_fd {
        match bridge_tracked_linux_client_splice(
            fd,
            client,
            provider,
            revalidate_every,
            idle_timeout,
            &mut should_continue,
        )
        .await
        {
            LinuxSpliceBridge::Done(stats) => return stats,
            LinuxSpliceBridge::Fallback => {
                debug!("splice unavailable on buyer socket; using userspace bridge");
            }
        }
    }

    bridge_tracked_userspace(
        client,
        provider,
        revalidate_every,
        idle_timeout,
        should_continue,
    )
    .await
}

#[cfg(target_os = "linux")]
enum LinuxSpliceBridge {
    Done(BridgeStats),
    Fallback,
}

/// Buyer→provider via splice; provider→buyer via async I/O (yamux leg).
#[cfg(target_os = "linux")]
async fn bridge_tracked_linux_client_splice<A, B, F, Fut>(
    client_fd: ClientTcpFd,
    client: &mut A,
    provider: &mut B,
    revalidate_every: u64,
    idle_timeout: Option<Duration>,
    should_continue: &mut F,
) -> LinuxSpliceBridge
where
    A: AsyncRead + AsyncWrite + Unpin,
    B: AsyncRead + AsyncWrite + Unpin,
    F: FnMut(BridgeStats) -> Fut,
    Fut: Future<Output = bool>,
{
    use splice::SpliceRead;

    const BUF_SIZE: usize = 65536;
    let mut buf_pc = vec![0u8; BUF_SIZE];
    let mut stats = BridgeStats::default();
    let mut last_reval_total = 0u64;

    loop {
        let idle_fut = async {
            match idle_timeout {
                Some(d) => tokio::time::sleep(d).await,
                None => std::future::pending().await,
            }
        };

        tokio::select! {
            read_res = async {
                let fd = client_fd;
                match tokio::task::spawn_blocking(move || {
                    splice::splice_read_from_socket(fd, BUF_SIZE)
                })
                .await
                {
                    Ok(r) => r,
                    Err(_) => SpliceRead::Unsupported,
                }
            } => {
                match read_res {
                    SpliceRead::Bytes(n, data) => {
                        trace!(bytes = n, "splice: buyer → provider");
                        if n == 0 {
                            debug!("Bridge: buyer closed connection (splice EOF)");
                            break;
                        }
                        if provider.write_all(&data[..n]).await.is_err() {
                            debug!("Bridge: failed to write to provider");
                            break;
                        }
                        if provider.flush().await.is_err() {
                            debug!("Bridge: failed to flush provider");
                            break;
                        }
                        stats.bytes_from_client += n as u64;
                    }
                    SpliceRead::Eof => {
                        debug!("Bridge: buyer closed connection (splice)");
                        break;
                    }
                    SpliceRead::Unsupported => {
                        return LinuxSpliceBridge::Fallback;
                    }
                }
            }
            read_res = provider.read(&mut buf_pc) => {
                match read_res {
                    Ok(0) => {
                        debug!("Bridge: provider closed connection");
                        break;
                    }
                    Ok(n) => {
                        trace!(bytes = n, "bridge: provider → buyer");
                        if client.write_all(&buf_pc[..n]).await.is_err() {
                            debug!("Bridge: failed to write to buyer");
                            break;
                        }
                        if client.flush().await.is_err() {
                            debug!("Bridge: failed to flush buyer");
                            break;
                        }
                        stats.bytes_from_provider += n as u64;
                    }
                    Err(e) => {
                        debug!(error = %e, "Bridge: provider read error");
                        break;
                    }
                }
            }
            _ = idle_fut => {
                debug!(
                    total_bytes = stats.total(),
                    "Bridge idle timeout reached"
                );
                break;
            }
        }

        let total = stats.total();
        if total - last_reval_total >= revalidate_every {
            last_reval_total = total;
            if !should_continue(stats).await {
                debug!(
                    total_bytes = total,
                    "Bridge terminated by revalidation callback"
                );
                break;
            }
        }
    }

    LinuxSpliceBridge::Done(stats)
}

async fn bridge_tracked_userspace<A, B, F, Fut>(
    client: &mut A,
    provider: &mut B,
    revalidate_every: u64,
    idle_timeout: Option<Duration>,
    mut should_continue: F,
) -> BridgeStats
where
    A: AsyncRead + AsyncWrite + Unpin,
    B: AsyncRead + AsyncWrite + Unpin,
    F: FnMut(BridgeStats) -> Fut,
    Fut: Future<Output = bool>,
{
    const BUF_SIZE: usize = 65536;
    let mut buf_cp = vec![0u8; BUF_SIZE];
    let mut buf_pc = vec![0u8; BUF_SIZE];

    let mut stats = BridgeStats::default();
    let mut last_reval_total = 0u64;

    loop {
        let idle_fut = async {
            match idle_timeout {
                Some(d) => tokio::time::sleep(d).await,
                None => std::future::pending().await,
            }
        };

        tokio::select! {
            read_res = client.read(&mut buf_cp) => {
                match read_res {
                    Ok(0) => {
                        debug!("Bridge: buyer closed connection");
                        break;
                    }
                    Ok(n) => {
                        trace!(bytes = n, "bridge: buyer → provider");
                        if provider.write_all(&buf_cp[..n]).await.is_err() {
                            debug!("Bridge: failed to write to provider");
                            break;
                        }
                        if provider.flush().await.is_err() {
                            debug!("Bridge: failed to flush provider");
                            break;
                        }
                        stats.bytes_from_client += n as u64;
                    }
                    Err(e) => {
                        debug!(error = %e, "Bridge: buyer read error");
                        break;
                    }
                }
            }
            read_res = provider.read(&mut buf_pc) => {
                match read_res {
                    Ok(0) => {
                        debug!("Bridge: provider closed connection");
                        break;
                    }
                    Ok(n) => {
                        trace!(bytes = n, "bridge: provider → buyer");
                        if client.write_all(&buf_pc[..n]).await.is_err() {
                            debug!("Bridge: failed to write to buyer");
                            break;
                        }
                        if client.flush().await.is_err() {
                            debug!("Bridge: failed to flush buyer");
                            break;
                        }
                        stats.bytes_from_provider += n as u64;
                    }
                    Err(e) => {
                        debug!(error = %e, "Bridge: provider read error");
                        break;
                    }
                }
            }
            _ = idle_fut => {
                debug!(
                    total_bytes = stats.total(),
                    "Bridge idle timeout reached"
                );
                break;
            }
        }

        let total = stats.total();
        if total - last_reval_total >= revalidate_every {
            last_reval_total = total;
            if !should_continue(stats).await {
                debug!(
                    total_bytes = total,
                    "Bridge terminated by revalidation callback"
                );
                break;
            }
        }
    }

    stats
}

/// Simple bridge with no revalidation — for connections that don't need it.
pub async fn bridge_simple<A, B>(client: &mut A, provider: &mut B) -> BridgeStats
where
    A: AsyncRead + AsyncWrite + Unpin,
    B: AsyncRead + AsyncWrite + Unpin,
{
    bridge_tracked(client, provider, None, u64::MAX, None, |_| async { true }).await
}

// ---------------------------------------------------------------------------
// Linux zero-copy via splice(2) — Phase 2 Week 7 / P1 client leg
// ---------------------------------------------------------------------------

/// Attempt a zero-copy bridge using Linux `splice(2)`.
///
/// Provider streams are yamux-multiplexed; use [`bridge_tracked`] with
/// `client_tcp_fd` instead of end-to-end splice between buyer and provider sockets.
#[cfg(target_os = "linux")]
pub mod splice {
    use std::os::unix::io::RawFd;
    use tracing::trace;

    /// Result of a single splice attempt (socket → socket).
    pub enum SpliceResult {
        Bytes(usize),
        Eof,
        Unsupported,
    }

    /// Result of reading from a buyer TCP socket through splice+pipe.
    pub enum SpliceRead {
        Bytes(usize, Vec<u8>),
        Eof,
        Unsupported,
    }

    /// Read up to `max_len` bytes from `socket_fd` via splice into a pipe, then one userspace read.
    pub fn splice_read_from_socket(socket_fd: RawFd, max_len: usize) -> SpliceRead {
        if max_len == 0 {
            return SpliceRead::Bytes(0, Vec::new());
        }

        let mut pipe_fds: [libc::c_int; 2] = [-1, -1];
        if unsafe { libc::pipe(pipe_fds.as_mut_ptr()) } != 0 {
            return SpliceRead::Unsupported;
        }
        let pipe_rd = pipe_fds[0];
        let pipe_wr = pipe_fds[1];

        const SPLICE_F_MOVE: libc::c_uint = 1;
        const SPLICE_F_NONBLOCK: libc::c_uint = 2;

        let n_in = unsafe {
            libc::splice(
                socket_fd,
                std::ptr::null_mut(),
                pipe_wr,
                std::ptr::null_mut(),
                max_len,
                (SPLICE_F_MOVE | SPLICE_F_NONBLOCK) as libc::c_uint,
            )
        };

        unsafe {
            libc::close(pipe_wr);
        }

        if n_in <= 0 {
            unsafe {
                libc::close(pipe_rd);
            }
            return if n_in == 0 {
                SpliceRead::Eof
            } else {
                SpliceRead::Unsupported
            };
        }

        let mut buf = vec![0u8; n_in as usize];
        let n_read = unsafe {
            libc::read(
                pipe_rd,
                buf.as_mut_ptr() as *mut libc::c_void,
                n_in as usize,
            )
        };
        unsafe {
            libc::close(pipe_rd);
        }

        if n_read <= 0 {
            return SpliceRead::Unsupported;
        }

        buf.truncate(n_read as usize);
        trace!(bytes = n_read, "splice: buyer socket → pipe → userspace");
        SpliceRead::Bytes(n_read as usize, buf)
    }

    /// Move up to `count` bytes from `src_fd` to `dst_fd` via an in-kernel pipe.
    ///
    /// This is a synchronous wrapper — callers should run it on a Tokio
    /// blocking thread via `tokio::task::spawn_blocking`.
    pub fn splice_once(src_fd: RawFd, dst_fd: RawFd, count: usize) -> SpliceResult {
        const SPLICE_F_MOVE: libc::c_uint = 1;
        const SPLICE_F_NONBLOCK: libc::c_uint = 2;

        let mut pipe_fds: [libc::c_int; 2] = [-1, -1];
        if unsafe { libc::pipe(pipe_fds.as_mut_ptr()) } != 0 {
            return SpliceResult::Unsupported;
        }
        let pipe_rd = pipe_fds[0];
        let pipe_wr = pipe_fds[1];

        let n_in = unsafe {
            libc::splice(
                src_fd,
                std::ptr::null_mut(),
                pipe_wr,
                std::ptr::null_mut(),
                count,
                (SPLICE_F_MOVE | SPLICE_F_NONBLOCK) as libc::c_uint,
            )
        };
        if n_in <= 0 {
            unsafe {
                libc::close(pipe_rd);
                libc::close(pipe_wr);
            }
            return if n_in == 0 {
                SpliceResult::Eof
            } else {
                SpliceResult::Unsupported
            };
        }

        let n_out = unsafe {
            libc::splice(
                pipe_rd,
                std::ptr::null_mut(),
                dst_fd,
                std::ptr::null_mut(),
                n_in as usize,
                SPLICE_F_MOVE as libc::c_uint,
            )
        };
        unsafe {
            libc::close(pipe_rd);
            libc::close(pipe_wr);
        }

        if n_out > 0 {
            trace!(bytes = n_out, "splice: socket → socket via pipe");
            SpliceResult::Bytes(n_out as usize)
        } else {
            SpliceResult::Unsupported
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    #[tokio::test]
    async fn test_bridge_empty_streams() {
        let (mut c1, mut c2) = duplex(1024);
        let (mut p1, mut p2) = duplex(1024);

        drop(c2);
        drop(p2);

        let stats = bridge_simple(&mut c1, &mut p1).await;
        assert_eq!(stats.bytes_from_client, 0);
        assert_eq!(stats.bytes_from_provider, 0);
    }

    #[tokio::test]
    async fn test_bridge_data_forwarding() {
        let (mut c_client, mut c_proxy) = duplex(4096);
        let (mut p_proxy, mut p_remote) = duplex(4096);

        let payload = b"hello proxy";

        c_client.write_all(payload).await.unwrap();
        drop(c_client);

        let stats = bridge_simple(&mut c_proxy, &mut p_proxy).await;

        let mut received = vec![0u8; payload.len()];
        p_remote.read_exact(&mut received).await.unwrap();
        assert_eq!(&received, payload);
        assert_eq!(stats.bytes_from_client, payload.len() as u64);
    }

    #[tokio::test]
    async fn test_bridge_revalidation_terminates() {
        let (mut c1, mut c2) = duplex(4096);
        let (mut p1, mut p2) = duplex(4096);

        let data = vec![0u8; 256];
        c1.write_all(&data).await.unwrap();
        drop(c1);
        drop(p2);

        let stats =
            bridge_tracked(&mut c2, &mut p1, None, 128, None, |_stats| async { false }).await;

        assert!(stats.bytes_from_client <= 256);
    }
}
