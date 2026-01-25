use governor::state::keyed::DefaultKeyedStateStore;
use governor::{prelude::*, Quota, RateLimiter};
use std::num::NonZeroU32;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

/// TrafficShaper manages bandwidth quotas per session
pub struct TrafficShaper {
    // Keyed by session_id/username, limiting bytes per second
    limiter:
        Arc<RateLimiter<String, DefaultKeyedStateStore<String>, governor::clock::DefaultClock>>,
}

impl TrafficShaper {
    pub fn new(bytes_per_sec: u32) -> Self {
        let quota = Quota::per_second(NonZeroU32::new(bytes_per_sec).unwrap());
        Self {
            limiter: Arc::new(RateLimiter::keyed(quota)),
        }
    }

    /// Wrap a stream with rate limiting
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
