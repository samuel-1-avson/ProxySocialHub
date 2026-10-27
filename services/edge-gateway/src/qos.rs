use governor::clock::{Clock, DefaultClock};
use governor::state::keyed::DefaultKeyedStateStore;
use governor::{prelude::*, Quota, RateLimiter};
use std::future::Future;
use std::num::NonZeroU32;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;
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
    default_bytes_per_sec: u32,
}

impl TrafficShaper {
    pub fn new(bytes_per_sec: u32) -> Self {
        let quota = Quota::per_second(NonZeroU32::new(bytes_per_sec.max(1)).unwrap());
        Self {
            limiter: Arc::new(RateLimiter::keyed(quota)),
            default_bytes_per_sec: bytes_per_sec.max(1),
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
            bytes_per_sec: self.default_bytes_per_sec,
            backoff: None,
        }
    }

    /// Wrap a stream with a per-session bandwidth cap (B-05).
    /// Use `bandwidth_cap_for_tier(&session.trust_tier)` to compute `bytes_per_sec`.
    pub fn wrap_with_cap<S>(&self, stream: S, key: String, bytes_per_sec: u32) -> ShapedStream<S>
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        // 0 means unlimited (see bridge_to_provider); do not clamp to 1 B/s.
        let cap = if bytes_per_sec == 0 {
            u32::MAX / 2
        } else {
            bytes_per_sec
        };
        let quota = Quota::per_second(NonZeroU32::new(cap.max(1)).unwrap());
        let limiter = Arc::new(RateLimiter::keyed(quota));
        ShapedStream {
            inner: stream,
            key,
            limiter,
            bytes_per_sec: cap,
            backoff: None,
        }
    }
}

pub struct ShapedStream<S> {
    inner: S,
    key: String,
    limiter:
        Arc<RateLimiter<String, DefaultKeyedStateStore<String>, governor::clock::DefaultClock>>,
    bytes_per_sec: u32,
    // DP-4: timer parked on when the bucket is empty. The previous
    // wake_by_ref()+Pending spun a full core per throttled session.
    backoff: Option<Pin<Box<tokio::time::Sleep>>>,
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
                    if self
                        .limiter
                        .check_key_n(&self.key, NonZeroU32::new(n as u32).unwrap())
                        .is_err()
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

        // Still waiting out a previous rate-limit decision: park on the
        // timer (its waker is registered) instead of busy-looping.
        if let Some(sleep) = self.backoff.as_mut() {
            match sleep.as_mut().poll(cx) {
                Poll::Ready(()) => self.backoff = None,
                Poll::Pending => return Poll::Pending,
            }
        }

        // governor keyed checks return Ok(Ok(..)) when allowed and
        // Ok(Err(NotUntil)) when throttled; the previous `Ok(_)` match
        // treated throttling as allowed, so shaping never engaged at all.
        // Never ask for more cells than the burst size either: that is an
        // InsufficientCapacity error no amount of waiting can satisfy, so
        // write at most one burst per poll (partial writes are legal).
        let want = n.min(self.bytes_per_sec.max(1) as usize);
        match self
            .limiter
            .check_key_n(&self.key, NonZeroU32::new(want as u32).unwrap())
        {
            Ok(Ok(_)) => Pin::new(&mut self.inner).poll_write(cx, &buf[..want]),
            Ok(Err(not_until)) => {
                let wait = not_until
                    .wait_time_from(DefaultClock::default().now())
                    .max(Duration::from_millis(1));
                let mut sleep = Box::pin(tokio::time::sleep(wait));
                // Register the current waker with the timer before parking.
                let _ = sleep.as_mut().poll(cx);
                self.backoff = Some(sleep);
                Poll::Pending
            }
            Err(_) => {
                // InsufficientCapacity despite the burst clamp above; park
                // briefly and re-check rather than spin.
                let mut sleep = Box::pin(tokio::time::sleep(Duration::from_millis(50)));
                let _ = sleep.as_mut().poll(cx);
                self.backoff = Some(sleep);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::task::Wake;
    use tokio::io::AsyncWriteExt;

    struct CountingWaker(AtomicUsize);

    impl Wake for CountingWaker {
        fn wake(self: Arc<Self>) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
        fn wake_by_ref(self: &Arc<Self>) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    // DP-4: a throttled write must park on a timer, not wake itself in a
    // spin. Pre-fix, poll_write on an empty bucket called wake_by_ref()
    // immediately (count >= 1); the timer version registers for a later
    // wake and returns Pending with zero immediate wakes.
    #[tokio::test]
    async fn throttled_write_parks_without_immediate_wake() {
        let shaper = TrafficShaper::new(1_000_000);
        let (a, _b) = tokio::io::duplex(8192);
        let mut stream = shaper.wrap_with_cap(a, "sess".to_string(), 10);

        let counter = Arc::new(CountingWaker(AtomicUsize::new(0)));
        let waker = counter.clone().into();
        {
            let mut cx = Context::from_waker(&waker);
            // Drain the burst (GCRA tolerance may admit slightly more than
            // one chunk; write until throttled).
            let mut throttled = false;
            for _ in 0..8 {
                match Pin::new(&mut stream).poll_write(&mut cx, &[7u8; 10]) {
                    Poll::Ready(Ok(10)) => {}
                    Poll::Pending => {
                        throttled = true;
                        break;
                    }
                    other => panic!("burst write should succeed or pend, got {other:?}"),
                }
            }
            assert!(throttled, "bucket never throttled within 8 chunks");
            // Bucket empty: must stay Pending without an immediate self-wake.
            counter.0.store(0, Ordering::SeqCst);
            match Pin::new(&mut stream).poll_write(&mut cx, &[7u8; 10]) {
                Poll::Pending => {}
                other => panic!("throttled write should be Pending, got {other:?}"),
            }
            assert_eq!(
                counter.0.load(Ordering::SeqCst),
                0,
                "throttled poll_write woke itself immediately (busy loop)"
            );
        }

        // And the write still completes once the bucket refills (~1s at 10 B/s).
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            stream.write_all(&[7u8; 10]),
        )
        .await
        .expect("write should complete after refill")
        .expect("write ok");
    }
}
