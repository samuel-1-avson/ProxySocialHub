use governor::state::keyed::DefaultKeyedStateStore;
use governor::{prelude::*, Quota, RateLimiter};
use std::num::NonZeroU32;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

/// Return the bandwidth cap in bytes/sec for a given trust tier (B-05).
pub fn bandwidth_cap_for_tier(tier: &str) -> u32 {
    match tier {
        "basic" => 2 * 1024 * 1024,     //  2 MB/s
        "standard" => 10 * 1024 * 1024, // 10 MB/s
        "premium" => 50 * 1024 * 1024,  // 50 MB/s
        "enterprise" => u32::MAX / 2,   // effectively unlimited (governor requires NonZeroU32)
        _ => 2 * 1024 * 1024,           // default: basic cap
    }
}

/// TrafficShaper manages per-session bandwidth quotas.
///
/// Use `wrap_with_cap(stream, key, bytes_per_sec)` to apply a tier-specific cap
/// (see `bandwidth_cap_for_tier`).  The legacy `wrap` method applies the default
/// shaper quota for backwards compatibility.
pub struct TrafficShaper {
    // Default limiter (used by `wrap`)
    limiter:
        Arc<RateLimiter<String, DefaultKeyedStateStore<String>, governor::clock::DefaultClock>>,
}

impl TrafficShaper {
    pub fn new(bytes_per_sec: u32) -> Self {
        let quota = Quota::per_second(NonZeroU32::new(bytes_per_sec.max(1)).unwrap());
        Self {
            limiter: Arc::new(RateLimiter::keyed(quota)),
        }
    }

    /// Wrap a stream with the default (shared) rate limiter.
    pub fn wrap<S>(&self, stream: S, key: String) -> ShapedStream<S>
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        ShapedStream {
            inner: stream,
            key,
            limiter: self.limiter.clone(),
        }
    }

    /// Wrap a stream with a per-session bandwidth cap (B-05).
    /// Use `bandwidth_cap_for_tier(&session.trust_tier)` to compute `bytes_per_sec`.
    pub fn wrap_with_cap<S>(&self, stream: S, key: String, bytes_per_sec: u32) -> ShapedStream<S>
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        let quota = Quota::per_second(NonZeroU32::new(bytes_per_sec.max(1)).unwrap());
        let limiter = Arc::new(RateLimiter::keyed(quota));
        ShapedStream {
            inner: stream,
            key,
            limiter,
        }
    }
}

pub struct ShapedStream<S> {
    inner: S,
    key: String,
    limiter:
        Arc<RateLimiter<String, DefaultKeyedStateStore<String>, governor::clock::DefaultClock>>,
}

impl<S: AsyncRead + Unpin> AsyncRead for ShapedStream<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        // We don't know how many bytes we'll read yet.
        // Option 1: Limit before read (pessimistic)
        // Option 2: Limit after read (reactive)
        // Reactive is easier for AsyncRead.

        let before = buf.filled().len();
        match Pin::new(&mut self.inner).poll_read(cx, buf) {
            Poll::Ready(Ok(())) => {
                let n = buf.filled().len() - before;
                if n > 0 {
                    // Weight the bucket by bytes read
                    if let Err(_) = self
                        .limiter
                        .check_key_n(&self.key, NonZeroU32::new(n as u32).unwrap())
                    {
                        // If we exceeded, we still return the data but we've "overdrawn"
                        // The next poll will yield.
                    }
                }
                Poll::Ready(Ok(()))
            }
            res => res,
        }
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for ShapedStream<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        let n = buf.len();
        if n == 0 {
            return Pin::new(&mut self.inner).poll_write(cx, buf);
        }

        match self
            .limiter
            .check_key_n(&self.key, NonZeroU32::new(n as u32).unwrap())
        {
            Ok(_) => Pin::new(&mut self.inner).poll_write(cx, buf),
            Err(_) => {
                cx.waker().wake_by_ref();
                Poll::Pending
            }
        }
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}
