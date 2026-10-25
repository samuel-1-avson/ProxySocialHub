//! Proxy handler: the exit-node logic that bridges Yamux streams to the internet.

use crate::config::Config;
use crate::stats::Collector;

use futures_util::{AsyncReadExt, AsyncWriteExt};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{lookup_host, TcpStream};
use tokio::time::timeout;
use tracing::{debug, error, warn};

/// Handles incoming proxy requests from the Edge Gateway.
#[derive(Clone)]
pub struct ProxyHandler {
    allowed_ports: Vec<u16>,
    blocked_hosts: Vec<String>,
    connect_timeout: Duration,
    stats: Collector,
}

impl ProxyHandler {
    pub fn new(cfg: &Config, stats: Collector) -> Self {
        Self {
            allowed_ports: cfg.allowed_ports.clone(),
            blocked_hosts: cfg.blocked_hosts.clone(),
            connect_timeout: cfg.connect_timeout,
            stats,
        }
    }

    /// Handle a single Yamux stream (one proxy request).
    pub async fn handle_stream(&self, mut stream: yamux::Stream) {
        // 1. Read the initial data. We need to be careful not to swallow
        // data that belongs to the proxied connection (like TLS Client Hello).
        let mut buf = [0u8; 4096];
        let n = match stream.read(&mut buf).await {
            Ok(n) if n > 0 => n,
            _ => return,
        };

        // Find the first newline which separates the command from any following data
        let (line_bytes, leftover) = match buf[..n].iter().position(|&b| b == b'\n') {
            Some(pos) => (&buf[..pos], &buf[pos + 1..n]),
            None => (&buf[..n], &buf[0..0]), // No newline found yet, unlikely for this protocol
        };

        let line = String::from_utf8_lossy(line_bytes);
        let line = line.trim();
        let parts: Vec<&str> = line.splitn(2, ' ').collect();

        if parts.len() < 2 {
            // Stats and Ping don't always have a target
            match parts[0] {
                "STATS" => {
                    self.handle_stats(&mut stream).await;
                    return;
                }
                "PING" => {
                    let _ = stream.write_all(b"PONG\n").await;
                    return;
                }
                _ => {
                    let _ = stream.write_all(b"ERROR Invalid command\n").await;
                    return;
                }
            }
        }

        let (cmd, target) = (parts[0], parts[1]);

        match cmd {
            "CONNECT" => self.handle_connect(&mut stream, target, leftover).await,
            "STATS" => self.handle_stats(&mut stream).await,
            "PING" => {
                let _ = stream.write_all(b"PONG\n").await;
            }
            other => {
                let _ = stream
                    .write_all(format!("ERROR Unknown command: {other}\n").as_bytes())
                    .await;
            }
        }
    }

    /// Execute an HTTP CONNECT: validate → dial target → bridge.
    async fn handle_connect(&self, stream: &mut yamux::Stream, target: &str, leftover: &[u8]) {
        debug!(target, "CONNECT request");

        let parsed = match parse_target(target) {
            Ok(parsed) => parsed,
            Err(e) => {
                warn!(target, error = %e, "Invalid target rejected");
                let _ = stream
                    .write_all(format!("ERROR Invalid target: {e}\n").as_bytes())
                    .await;
                return;
            }
        };

        if !self.is_valid_target(&parsed) {
            warn!(target, "Invalid target rejected");
            let _ = stream
                .write_all(b"ERROR Invalid target: access denied\n")
                .await;
            return;
        }

        if !self.is_port_allowed(parsed.port) {
            warn!(target, "Port not allowed");
            let _ = stream.write_all(b"ERROR Port not allowed\n").await;
            return;
        }

        if self.is_host_blocked(&parsed.host) {
            warn!(target, "Host blocked");
            let _ = stream.write_all(b"ERROR Host blocked\n").await;
            return;
        }

        let addrs = match self.resolve_allowed_target(&parsed).await {
            Ok(addrs) => addrs,
            Err(e) => {
                warn!(target, error = %e, "Resolved target rejected");
                let _ = stream
                    .write_all(format!("ERROR Invalid target: {e}\n").as_bytes())
                    .await;
                return;
            }
        };

        let target_conn = match self.connect_resolved_target(&addrs).await {
            Ok(c) => c,
            Err(e) => {
                error!(target, error = %e, "Failed to connect to target");
                let _ = stream
                    .write_all(format!("ERROR Connection failed: {e}\n").as_bytes())
                    .await;
                return;
            }
        };

        debug!(target, "Target connected");

        // Send OK
        if let Err(e) = stream.write_all(b"OK\n").await {
            error!(target, error = %e, "Failed to send OK response");
            return;
        }
        let _ = stream.flush().await;

        self.stats.record_connection_opened();
        self.bridge(stream, target_conn, leftover).await;
        self.stats.record_connection_closed();
    }

    /// Bidirectional bridge between a yamux stream (futures I/O) and a tokio TcpStream.
    async fn bridge(&self, stream: &mut yamux::Stream, target: TcpStream, leftover: &[u8]) {
        use tokio::io::AsyncWriteExt as _;
        use tokio_util::compat::FuturesAsyncReadCompatExt;
        use tracing::info;

        let mut target = target;
        let leftover_n = leftover.len() as u64;

        // 1. Forward leftover bytes to target if any (TLS ClientHello after CONNECT).
        if leftover_n > 0 {
            info!("Forwarding {} leftover bytes to target", leftover.len());
            if let Err(e) = target.write_all(leftover).await {
                error!(error = %e, "Failed to write leftover data to target");
                record_bridge_traffic(&self.stats, leftover_n, 0, 0);
                return;
            }
            let _ = target.flush().await;
        }

        let mut stream_io = MeteredIo {
            inner: stream.compat(),
            read: 0,
            written: 0,
        };
        let mut target_io = MeteredIo {
            inner: target,
            read: 0,
            written: 0,
        };

        info!("Starting bidirectional bridge (copy_bidirectional)");
        match tokio::io::copy_bidirectional(&mut stream_io, &mut target_io).await {
            Ok((from_stream, to_stream)) => {
                info!(from_stream, to_stream, "Bridge closed normally");
            }
            Err(e) => {
                info!("Bridge closed with error: {}", e);
            }
        }
        // Count leftover + whatever the copy moved, including RST/broken-pipe closes.
        record_bridge_traffic(&self.stats, leftover_n, stream_io.read, target_io.read);
        info!("Bridge closed");
    }

    async fn handle_stats(&self, stream: &mut yamux::Stream) {
        let snap = self.stats.snapshot();
        let resp = format!(
            "ACTIVE:{} UP:{} DOWN:{} TOTAL:{}\n",
            snap.active_connections, snap.bytes_up, snap.bytes_down, snap.total_connections,
        );
        let _ = stream.write_all(resp.as_bytes()).await;
    }

    // ── Validation helpers ──────────────────────────────────────────

    fn is_valid_target(&self, target: &ParsedTarget) -> bool {
        target
            .host
            .parse::<IpAddr>()
            .map(is_public_ip)
            .unwrap_or(true)
    }

    fn is_port_allowed(&self, port: u16) -> bool {
        if self.allowed_ports.is_empty() {
            return true;
        }
        self.allowed_ports.contains(&port)
    }

    fn is_host_blocked(&self, host: &str) -> bool {
        let host_lower = host.to_lowercase();
        self.blocked_hosts
            .iter()
            .any(|b| host_lower.contains(&b.to_lowercase()))
    }

    async fn resolve_allowed_target(
        &self,
        target: &ParsedTarget,
    ) -> Result<Vec<SocketAddr>, TargetValidationError> {
        let resolved = timeout(
            self.connect_timeout,
            lookup_host((target.host.as_str(), target.port)),
        )
        .await
        .map_err(|_| TargetValidationError::ResolveTimeout)??;

        let addrs: Vec<SocketAddr> = resolved.collect();
        if addrs.is_empty() {
            return Err(TargetValidationError::NoResolvedAddresses);
        }

        if let Some(addr) = addrs.iter().find(|addr| !is_public_ip(addr.ip())) {
            return Err(TargetValidationError::UnsafeResolvedAddress(*addr));
        }

        Ok(addrs)
    }

    async fn connect_resolved_target(&self, addrs: &[SocketAddr]) -> std::io::Result<TcpStream> {
        let mut last_err = None;
        for addr in addrs {
            match timeout(self.connect_timeout, TcpStream::connect(addr)).await {
                Ok(Ok(stream)) => return Ok(stream),
                Ok(Err(err)) => last_err = Some(err),
                Err(_) => {
                    last_err = Some(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        format!("connect timeout after {:?}", self.connect_timeout),
                    ));
                }
            }
        }

        Err(last_err.unwrap_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::AddrNotAvailable, "no target addresses")
        }))
    }
}

/// Count leftover (pre-copy ClientHello) plus bytes the node read from the
/// buyer stream and from the origin. Matches the previous up/down mapping:
/// origin→buyer is uplink, buyer→origin is downlink.
fn record_bridge_traffic(stats: &Collector, leftover: u64, yamux_read: u64, origin_read: u64) {
    stats.record_bytes_down(leftover.saturating_add(yamux_read));
    stats.record_bytes_up(origin_read);
}

struct MeteredIo<T> {
    inner: T,
    read: u64,
    #[allow(dead_code)]
    written: u64,
}

impl<T: AsyncRead + Unpin> AsyncRead for MeteredIo<T> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let before = buf.filled().len();
        let poll = Pin::new(&mut self.inner).poll_read(cx, buf);
        if let Poll::Ready(Ok(())) = &poll {
            self.read += (buf.filled().len() - before) as u64;
        }
        poll
    }
}

impl<T: AsyncWrite + Unpin> AsyncWrite for MeteredIo<T> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        let poll = Pin::new(&mut self.inner).poll_write(cx, buf);
        if let Poll::Ready(Ok(n)) = &poll {
            self.written += *n as u64;
        }
        poll
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedTarget {
    host: String,
    port: u16,
}

#[derive(Debug)]
enum TargetValidationError {
    InvalidFormat,
    EmptyHost,
    InvalidPort,
    PortZero,
    ResolveTimeout,
    Resolve(std::io::Error),
    NoResolvedAddresses,
    UnsafeResolvedAddress(SocketAddr),
}

impl std::fmt::Display for TargetValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidFormat => write!(f, "expected host:port"),
            Self::EmptyHost => write!(f, "host is empty"),
            Self::InvalidPort => write!(f, "port is invalid"),
            Self::PortZero => write!(f, "port must be greater than zero"),
            Self::ResolveTimeout => write!(f, "DNS resolution timed out"),
            Self::Resolve(err) => write!(f, "DNS resolution failed: {err}"),
            Self::NoResolvedAddresses => write!(f, "DNS resolution returned no addresses"),
            Self::UnsafeResolvedAddress(addr) => {
                write!(f, "resolved address {addr} is not allowed")
            }
        }
    }
}

impl std::error::Error for TargetValidationError {}

impl From<std::io::Error> for TargetValidationError {
    fn from(value: std::io::Error) -> Self {
        Self::Resolve(value)
    }
}

fn parse_target(target: &str) -> Result<ParsedTarget, TargetValidationError> {
    let target = target.trim();
    if target.is_empty() {
        return Err(TargetValidationError::InvalidFormat);
    }

    if let Ok(addr) = target.parse::<SocketAddr>() {
        return Ok(ParsedTarget {
            host: addr.ip().to_string(),
            port: addr.port(),
        });
    }

    if let Some(rest) = target.strip_prefix('[') {
        let Some((host, port_part)) = rest.split_once("]:") else {
            return Err(TargetValidationError::InvalidFormat);
        };
        return parsed_host_port(host, port_part);
    }

    let Some((host, port_part)) = target.rsplit_once(':') else {
        return Err(TargetValidationError::InvalidFormat);
    };
    if host.contains(':') {
        return Err(TargetValidationError::InvalidFormat);
    }
    parsed_host_port(host, port_part)
}

fn parsed_host_port(host: &str, port_part: &str) -> Result<ParsedTarget, TargetValidationError> {
    let host = host.trim().trim_end_matches('.');
    if host.is_empty() {
        return Err(TargetValidationError::EmptyHost);
    }
    let port = port_part
        .parse::<u16>()
        .map_err(|_| TargetValidationError::InvalidPort)?;
    if port == 0 {
        return Err(TargetValidationError::PortZero);
    }
    Ok(ParsedTarget {
        host: host.to_string(),
        port,
    })
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_ipv4(v4),
        IpAddr::V6(v6) => is_public_ipv6(v6),
    }
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_multicast()
        || ip.is_unspecified()
        || ip.is_broadcast()
        // 0.0.0.0/8 ("this network", RFC 1122); also what `::2` style IPv4-compatible
        // addresses decode to.
        || ip.octets()[0] == 0
        || is_ipv4_shared(ip)
        || is_ipv4_documentation(ip)
        || is_ipv4_reserved_benchmark(ip))
}

fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    if ip.is_loopback()
        || ip.is_multicast()
        || ip.is_unspecified()
        || is_ipv6_unique_local(ip)
        || is_ipv6_unicast_link_local(ip)
        || is_ipv6_documentation(ip)
        || is_ipv6_discard_only(ip)
    {
        return false;
    }
    // Addresses that carry an IPv4 address are judged by that IPv4 address. Without
    // this, ::ffff:127.0.0.1 or ::ffff:169.254.169.254 would pass as "public IPv6"
    // and reach the provider's loopback, LAN or cloud metadata endpoint.
    match embedded_ipv4(ip) {
        Some(v4) => is_public_ipv4(v4),
        None => true,
    }
}

/// The IPv4 address carried by an IPv4-mapped (`::ffff:a.b.c.d`), IPv4-compatible
/// (`::a.b.c.d`), NAT64 (`64:ff9b::/96`) or 6to4 (`2002::/16`) address.
fn embedded_ipv4(ip: Ipv6Addr) -> Option<Ipv4Addr> {
    if let Some(v4) = ip.to_ipv4() {
        // Covers both mapped and compatible forms. `::` and `::1` never reach here
        // because the caller rejects them first.
        return Some(v4);
    }
    let seg = ip.segments();
    let v4_from = |hi: u16, lo: u16| {
        let [a, b] = hi.to_be_bytes();
        let [c, d] = lo.to_be_bytes();
        Ipv4Addr::new(a, b, c, d)
    };
    if seg[0] == 0x0064 && seg[1] == 0xff9b && seg[2..6].iter().all(|s| *s == 0) {
        return Some(v4_from(seg[6], seg[7]));
    }
    if seg[0] == 0x2002 {
        return Some(v4_from(seg[1], seg[2]));
    }
    None
}

fn is_ipv4_shared(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    octets[0] == 100 && (64..=127).contains(&octets[1])
}

fn is_ipv4_documentation(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    matches!(
        octets,
        [192, 0, 2, _] | [198, 51, 100, _] | [203, 0, 113, _]
    )
}

fn is_ipv4_reserved_benchmark(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    octets[0] == 198 && matches!(octets[1], 18 | 19)
}

fn is_ipv6_unique_local(ip: Ipv6Addr) -> bool {
    (ip.segments()[0] & 0xfe00) == 0xfc00
}

fn is_ipv6_unicast_link_local(ip: Ipv6Addr) -> bool {
    (ip.segments()[0] & 0xffc0) == 0xfe80
}

fn is_ipv6_documentation(ip: Ipv6Addr) -> bool {
    ip.segments()[0] == 0x2001 && ip.segments()[1] == 0x0db8
}

/// 100::/64 is the discard-only prefix (RFC 6666); nothing there is a real host.
fn is_ipv6_discard_only(ip: Ipv6Addr) -> bool {
    let seg = ip.segments();
    seg[0] == 0x0100 && seg[1..4].iter().all(|s| *s == 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats::Collector;

    fn handler() -> ProxyHandler {
        let mut cfg = Config::default();
        cfg.allowed_ports = vec![80, 443];
        cfg.connect_timeout = Duration::from_secs(1);
        ProxyHandler::new(&cfg, Collector::new())
    }

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap_or_else(|_| panic!("bad test ip {s}"))
    }

    // DP-CRIT-02: a hostname with an AAAA record of ::ffff:127.0.0.1 must not
    // reach the provider's loopback, LAN or cloud metadata endpoint.
    #[test]
    fn ipv4_mapped_ipv6_is_judged_by_embedded_ipv4() {
        for blocked in [
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.5",
            "::ffff:192.168.1.1",
            "::ffff:172.16.0.9",
            "::ffff:169.254.169.254",
            "::ffff:100.64.0.1",
            "::ffff:0.0.0.0",
        ] {
            assert!(!is_public_ip(ip(blocked)), "{blocked} must not be public");
        }
        assert!(is_public_ip(ip("::ffff:8.8.8.8")));
    }

    #[test]
    fn other_ipv4_embedding_ipv6_forms_are_judged_by_embedded_ipv4() {
        // NAT64 well-known prefix 64:ff9b::/96
        assert!(!is_public_ip(ip("64:ff9b::7f00:1")));
        assert!(!is_public_ip(ip("64:ff9b::a9fe:a9fe")));
        assert!(is_public_ip(ip("64:ff9b::808:808")));
        // 6to4 2002::/16 carries the IPv4 in the next 32 bits
        assert!(!is_public_ip(ip("2002:7f00:1::1")));
        assert!(!is_public_ip(ip("2002:c0a8:101::1")));
        assert!(is_public_ip(ip("2002:808:808::1")));
        // Deprecated IPv4-compatible ::a.b.c.d
        assert!(!is_public_ip(ip("::127.0.0.2")));
        assert!(!is_public_ip(ip("::2")));
        assert!(!is_public_ip(ip("0.0.0.5")));
    }

    #[test]
    fn reserved_ipv6_ranges_stay_blocked_and_global_unicast_stays_public() {
        for blocked in [
            "::1",
            "::",
            "fe80::1",
            "fc00::1",
            "fd12:3456::1",
            "ff02::1",
            "2001:db8::1",
            "100::1",
        ] {
            assert!(!is_public_ip(ip(blocked)), "{blocked} must not be public");
        }
        assert!(is_public_ip(ip("2606:4700:4700::1111")));
        assert!(is_public_ip(ip("2001:4860:4860::8888")));
    }

    #[test]
    fn parses_hostname_and_ipv6_targets() {
        assert_eq!(
            parse_target("example.com:443").unwrap(),
            ParsedTarget {
                host: "example.com".to_string(),
                port: 443,
            }
        );
        assert_eq!(
            parse_target("[2606:4700:4700::1111]:443").unwrap(),
            ParsedTarget {
                host: "2606:4700:4700::1111".to_string(),
                port: 443,
            }
        );
        assert!(parse_target("2606:4700:4700::1111:443").is_err());
        assert!(parse_target("example.com").is_err());
        assert!(parse_target("example.com:0").is_err());
    }

    #[test]
    fn rejects_unsafe_ip_literals() {
        let handler = handler();
        for target in [
            "127.0.0.1:80",
            "10.0.0.1:80",
            "172.16.0.1:80",
            "192.168.1.1:80",
            "169.254.169.254:80",
            "100.64.0.1:80",
            "0.0.0.0:80",
            "255.255.255.255:80",
            "[::1]:443",
            "[fc00::1]:443",
            "[fd00::1]:443",
            "[fe80::1]:443",
        ] {
            let parsed = parse_target(target).unwrap();
            assert!(
                !handler.is_valid_target(&parsed),
                "{target} should be blocked"
            );
        }
    }

    #[test]
    fn allows_public_ip_literals() {
        let handler = handler();
        for target in ["1.1.1.1:443", "8.8.8.8:443", "[2606:4700:4700::1111]:443"] {
            let parsed = parse_target(target).unwrap();
            assert!(
                handler.is_valid_target(&parsed),
                "{target} should be allowed"
            );
        }
    }

    #[test]
    fn applies_allowed_ports_to_parsed_target() {
        let handler = handler();
        assert!(handler.is_port_allowed(parse_target("example.com:443").unwrap().port));
        assert!(!handler.is_port_allowed(parse_target("example.com:25").unwrap().port));
    }

    #[tokio::test]
    async fn rejects_hostname_that_resolves_to_localhost() {
        let handler = handler();
        let parsed = parse_target("localhost:80").unwrap();
        let err = handler.resolve_allowed_target(&parsed).await.unwrap_err();
        assert!(
            matches!(err, TargetValidationError::UnsafeResolvedAddress(_)),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn records_leftover_and_origin_bytes_even_without_clean_close() {
        let stats = Collector::new();
        record_bridge_traffic(&stats, 120, 80, 400);
        assert_eq!(stats.bytes_down(), 200);
        assert_eq!(stats.bytes_up(), 400);
    }
}
