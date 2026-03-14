//! HTTP/2 CONNECT proxy support (RFC 7540 §8.3, P2-W5).
//!
//! Hyper maps HTTP/2 pseudo-headers (`:method`, `:authority`) onto the same
//! `http::Request` fields as HTTP/1.1, so the existing `proxy()` service
//! function handles HTTP/2 CONNECT with zero changes.
//!
//! What **does** change is the server-connection builder: we swap from
//! `hyper::server::conn::http1::Builder` to
//! `hyper_util::server::conn::auto::Builder`.  The auto-builder detects the
//! HTTP/2 connection preface on plaintext (h2c) and negotiates h2 via ALPN on
//! TLS connections — giving HTTP/2 CONNECT support for free.

use hyper_util::rt::TokioExecutor;
use hyper_util::server::conn::auto::Builder as AutoBuilder;

/// Create an auto-detecting HTTP/1.1 + HTTP/2 connection builder.
///
/// Replaces `hyper::server::conn::http1::Builder` throughout the server loop.
/// On TLS connections the protocol is chosen via ALPN; on plaintext, hyper
/// detects the HTTP/2 connection preface automatically (h2c prior knowledge).
///
/// Phase 2 note: for ALPN-based protocol negotiation, the `tls.rs` module
/// should advertise `["h2", "http/1.1"]` in the TLS config (Week 8 task).
pub fn make_auto_builder() -> AutoBuilder<TokioExecutor> {
    AutoBuilder::new(TokioExecutor::new())
}

/// Describes the protocol detected for an incoming connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetectedProtocol {
    Http1,
    Http2,
    Unknown,
}

/// Peek at the first 3 bytes of an unread stream to guess the protocol.
///
/// The HTTP/2 connection preface starts with `PRI` (0x50 0x52 0x49).
/// Used only for diagnostic logging — the auto-builder handles actual dispatch.
pub fn detect_from_preface(buf: &[u8]) -> DetectedProtocol {
    if buf.len() >= 3 && &buf[..3] == b"PRI" {
        DetectedProtocol::Http2
    } else if buf.len() >= 3 && &buf[..3] == b"GET"
        || buf.len() >= 4 && &buf[..4] == b"POST"
        || buf.len() >= 7 && &buf[..7] == b"CONNECT"
    {
        DetectedProtocol::Http1
    } else {
        DetectedProtocol::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_h2_preface() {
        let preface = b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";
        assert_eq!(detect_from_preface(preface), DetectedProtocol::Http2);
    }

    #[test]
    fn test_detect_h1_connect() {
        let req = b"CONNECT example.com:443 HTTP/1.1\r\n";
        assert_eq!(detect_from_preface(req), DetectedProtocol::Http1);
    }

    #[test]
    fn test_detect_unknown() {
        assert_eq!(detect_from_preface(b"\x00\x01\x02"), DetectedProtocol::Unknown);
    }
}
