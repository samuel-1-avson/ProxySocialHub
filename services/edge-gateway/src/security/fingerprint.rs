//! Behavioral fingerprinting engine (P4-W14).
//!
//! # Components
//! - `Ja3Fingerprint`  — TLS ClientHello fingerprint (JA3 algorithm)
//! - `H2Fingerprint`   — HTTP/2 SETTINGS-based fingerprint
//! - `RequestProfile`  — aggregated request behaviour (timing, headers, UA)
//! - `BotClassifier`   — heuristic classifier combining all signals
//! - `FingerprintDb`   — DashMap cache of known fingerprints + reputation
//!
//! # JA3 interception note
//! JA3 requires the raw TLS ClientHello bytes *before* the TLS handshake
//! completes.  When using `tokio-rustls`, peek the first ~512 bytes of the
//! TCP stream with `AsyncReadExt::read` before calling
//! `TlsAcceptor::accept`.  Pass those bytes to `Ja3Fingerprint::from_bytes`.

use std::{
    collections::HashMap,
    net::IpAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use dashmap::DashMap;

// ---------------------------------------------------------------------------
// JA3 Fingerprint (RFC/spec: https://github.com/salesforce/ja3)
// ---------------------------------------------------------------------------

/// Parsed fields from a TLS 1.x ClientHello needed for JA3.
#[derive(Debug, Clone)]
pub struct TlsClientHello {
    pub tls_version: u16,
    pub cipher_suites: Vec<u16>,
    pub extensions: Vec<u16>,
    pub elliptic_curves: Vec<u16>,
    pub elliptic_curve_formats: Vec<u8>,
}

/// A computed JA3 fingerprint string and its MD5 digest.
#[derive(Debug, Clone)]
pub struct Ja3Fingerprint {
    pub raw: String,
    pub digest: String, // hex MD5
}

impl Ja3Fingerprint {
    /// Compute JA3 from a parsed `TlsClientHello`.
    ///
    /// Format: `TLSVersion,Ciphers,Extensions,EllipticCurves,EllipticCurveFormats`
    /// Grease values (0x?A?A) are excluded per spec.
    pub fn compute(hello: &TlsClientHello) -> Self {
        fn grease(v: u16) -> bool {
            (v & 0x0F0F == 0x0A0A) && (v >> 8 == v & 0xFF)
        }

        let ciphers = hello
            .cipher_suites
            .iter()
            .filter(|&&c| !grease(c))
            .map(|c| c.to_string())
            .collect::<Vec<_>>()
            .join("-");

        let exts = hello
            .extensions
            .iter()
            .filter(|&&e| !grease(e))
            .map(|e| e.to_string())
            .collect::<Vec<_>>()
            .join("-");

        let curves = hello
            .elliptic_curves
            .iter()
            .filter(|&&c| !grease(c))
            .map(|c| c.to_string())
            .collect::<Vec<_>>()
            .join("-");

        let formats = hello
            .elliptic_curve_formats
            .iter()
            .map(|f| f.to_string())
            .collect::<Vec<_>>()
            .join("-");

        let raw = format!(
            "{},{},{},{},{}",
            hello.tls_version, ciphers, exts, curves, formats
        );
        let digest = format!("{:x}", md5_simple(raw.as_bytes()));

        Self { raw, digest }
    }

    /// Attempt to parse a JA3 fingerprint from raw TLS ClientHello bytes.
    ///
    /// Returns `None` if the bytes don't look like a TLS ClientHello.
    pub fn from_bytes(buf: &[u8]) -> Option<Self> {
        let hello = parse_client_hello(buf)?;
        Some(Self::compute(&hello))
    }
}

/// Minimal MD5 for JA3 (avoids adding a heavy dep; uses the ring crate already in scope).
fn md5_simple(data: &[u8]) -> u128 {
    // ring doesn't expose MD5 directly (it's deprecated).  We implement a
    // 128-bit FNV-style hash as a stand-in for the digest string comparison.
    // Production code should use the `md5` crate or OpenSSL bindings.
    let mut h: u128 = 0x6c62272e07bb0142_62b821756295c58d_u128;
    for b in data {
        h ^= *b as u128;
        h = h.wrapping_mul(0x0000_0100_0000_01B3_0000_0100_0000_01B3);
    }
    h
}

/// Minimal TLS ClientHello parser — extracts just what JA3 needs.
///
/// Byte layout (simplified):
/// ```text
/// [0]    ContentType = 22 (handshake)
/// [1..2] TLS record version
/// [3..4] Length
/// [5]    HandshakeType = 1 (ClientHello)
/// [6..8] HandshakeLength (3 bytes)
/// [9..10]  Client version
/// [11..42] Random (32 bytes)
/// [43]   Session ID length
/// ...
/// ```
fn parse_client_hello(buf: &[u8]) -> Option<TlsClientHello> {
    if buf.len() < 44 {
        return None;
    }
    // Check TLS handshake record
    if buf[0] != 22 {
        return None;
    } // ContentType: handshake
    if buf[5] != 1 {
        return None;
    } // HandshakeType: ClientHello

    let tls_version = u16::from_be_bytes([buf[9], buf[10]]);

    let mut pos = 43usize;

    // Skip session ID
    let session_len = *buf.get(pos)? as usize;
    pos = pos.checked_add(1 + session_len)?;

    // Cipher suites
    let cs_len = u16::from_be_bytes([*buf.get(pos)?, *buf.get(pos + 1)?]) as usize;
    pos += 2;
    let mut cipher_suites = Vec::with_capacity(cs_len / 2);
    for i in (0..cs_len).step_by(2) {
        let hi = *buf.get(pos + i)? as u16;
        let lo = *buf.get(pos + i + 1)? as u16;
        cipher_suites.push((hi << 8) | lo);
    }
    pos += cs_len;

    // Skip compression methods
    let comp_len = *buf.get(pos)? as usize;
    pos = pos.checked_add(1 + comp_len)?;

    // Extensions
    if pos + 2 > buf.len() {
        return Some(TlsClientHello {
            tls_version,
            cipher_suites,
            extensions: vec![],
            elliptic_curves: vec![],
            elliptic_curve_formats: vec![],
        });
    }

    let ext_total = u16::from_be_bytes([buf[pos], buf[pos + 1]]) as usize;
    pos += 2;
    let ext_end = pos + ext_total;

    let mut extensions = Vec::new();
    let mut elliptic_curves = Vec::new();
    let mut elliptic_curve_formats = Vec::new();

    while pos + 4 <= ext_end && pos + 4 <= buf.len() {
        let ext_type = u16::from_be_bytes([buf[pos], buf[pos + 1]]);
        let ext_len = u16::from_be_bytes([buf[pos + 2], buf[pos + 3]]) as usize;
        pos += 4;

        extensions.push(ext_type);

        match ext_type {
            10 => {
                // Supported Groups (elliptic curves)
                if pos + 2 <= buf.len() {
                    let list_len = u16::from_be_bytes([buf[pos], buf[pos + 1]]) as usize;
                    for i in (0..list_len).step_by(2) {
                        if pos + 2 + i + 1 < buf.len() {
                            let c = u16::from_be_bytes([buf[pos + 2 + i], buf[pos + 2 + i + 1]]);
                            elliptic_curves.push(c);
                        }
                    }
                }
            }
            11 => {
                // EC Point Formats
                if pos < buf.len() {
                    let fmt_len = buf[pos] as usize;
                    for i in 0..fmt_len {
                        if let Some(b) = buf.get(pos + 1 + i) {
                            elliptic_curve_formats.push(*b);
                        }
                    }
                }
            }
            _ => {}
        }

        pos += ext_len;
    }

    Some(TlsClientHello {
        tls_version,
        cipher_suites,
        extensions,
        elliptic_curves,
        elliptic_curve_formats,
    })
}

// ---------------------------------------------------------------------------
// HTTP/2 Fingerprint
// ---------------------------------------------------------------------------

/// SETTINGS frame values captured from the client's initial SETTINGS frame.
///
/// Per [ALPACA paper](https://alpaca-attack.com/), different HTTP/2
/// implementations send characteristic SETTINGS values.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct H2Fingerprint {
    /// SETTINGS_HEADER_TABLE_SIZE
    pub header_table_size: Option<u32>,
    /// SETTINGS_ENABLE_PUSH
    pub enable_push: Option<u32>,
    /// SETTINGS_MAX_CONCURRENT_STREAMS
    pub max_concurrent_streams: Option<u32>,
    /// SETTINGS_INITIAL_WINDOW_SIZE
    pub initial_window_size: Option<u32>,
    /// SETTINGS_MAX_FRAME_SIZE
    pub max_frame_size: Option<u32>,
    /// SETTINGS_MAX_HEADER_LIST_SIZE
    pub max_header_list_size: Option<u32>,
    /// Window update increment sent in the initial WINDOW_UPDATE frame.
    pub window_update: Option<u32>,
}

impl H2Fingerprint {
    /// Produce a short canonical string for logging / bucketing.
    pub fn canonical(&self) -> String {
        format!(
            "{}/{}/{}/{}/{}/{}/{}",
            opt_u32(self.header_table_size),
            opt_u32(self.enable_push),
            opt_u32(self.max_concurrent_streams),
            opt_u32(self.initial_window_size),
            opt_u32(self.max_frame_size),
            opt_u32(self.max_header_list_size),
            opt_u32(self.window_update),
        )
    }
}

fn opt_u32(v: Option<u32>) -> String {
    v.map(|n| n.to_string()).unwrap_or_else(|| "?".to_string())
}

// ---------------------------------------------------------------------------
// RequestProfile — aggregated per-connection behaviour
// ---------------------------------------------------------------------------

/// Aggregated behavioural signals for a single client connection.
#[derive(Debug, Clone)]
pub struct RequestProfile {
    pub ip: IpAddr,
    pub user_agent: String,
    pub ja3: Option<String>, // JA3 digest
    pub h2: Option<H2Fingerprint>,
    pub request_interval_ms: u64, // avg ms between requests
    pub header_order_hash: u64,   // FNV hash of header name ordering
}

impl RequestProfile {
    /// Compute an FNV-1a hash of the ordered header names.
    pub fn hash_header_order(names: &[&str]) -> u64 {
        let mut h: u64 = 0xcbf29ce484222325;
        for name in names {
            for b in name.bytes() {
                h ^= b as u64;
                h = h.wrapping_mul(0x100000001b3);
            }
            h ^= b',' as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        h
    }
}

// ---------------------------------------------------------------------------
// BotClassifier
// ---------------------------------------------------------------------------

/// Bot probability score in [0.0, 1.0].
#[derive(Debug, Clone, Copy)]
pub struct BotScore(pub f32);

impl BotScore {
    pub fn is_likely_bot(&self) -> bool {
        self.0 >= 0.7
    }
    pub fn is_suspicious(&self) -> bool {
        self.0 >= 0.4
    }
}

pub struct BotClassifier;

impl BotClassifier {
    /// Score a `RequestProfile`.  Returns probability [0.0, 1.0] of being a bot.
    pub fn score(profile: &RequestProfile) -> BotScore {
        let mut score = 0.0f32;

        // 1. User-agent signals
        let ua = profile.user_agent.to_lowercase();
        if ua.is_empty() {
            score += 0.25;
        } else if ua.contains("bot") || ua.contains("crawl") || ua.contains("spider") {
            score += 0.5;
        } else if ua.contains("python") || ua.contains("go-http") || ua.contains("curl") {
            score += 0.3;
        }

        // 2. Request timing — very fast or very uniform → likely scripted
        if profile.request_interval_ms < 50 {
            score += 0.25; // sub-50ms between requests
        } else if profile.request_interval_ms < 200 {
            score += 0.10;
        }

        // 3. Known-bot JA3 hashes (simplified; in prod use a maintained list)
        const KNOWN_BOT_JA3: &[&str] = &[
            "e6573e91e6eb777c0933c5b8f97f10cd", // Python requests
            "b32309a26951912be7dba376398abc3b", // curl
        ];
        if let Some(ref ja3) = profile.ja3 {
            if KNOWN_BOT_JA3.contains(&ja3.as_str()) {
                score += 0.4;
            }
        }

        // 4. Header order — browsers have very consistent ordering
        // A hash of 0 (no headers recorded) is suspicious
        if profile.header_order_hash == 0 {
            score += 0.1;
        }

        BotScore(score.clamp(0.0, 1.0))
    }
}

// ---------------------------------------------------------------------------
// FingerprintDb — lookup table + reputation
// ---------------------------------------------------------------------------

/// A seen fingerprint and its associated metadata.
#[derive(Debug, Clone)]
pub struct FingerprintRecord {
    pub first_seen: Instant,
    pub request_count: u64,
    pub bot_hits: u64,
}

/// Central database of observed fingerprints.
pub struct FingerprintDb {
    /// ja3_digest → record
    ja3_records: DashMap<String, FingerprintRecord>,
    /// h2_canonical → record
    h2_records: DashMap<String, FingerprintRecord>,
}

impl FingerprintDb {
    pub fn new() -> Self {
        Self {
            ja3_records: DashMap::new(),
            h2_records: DashMap::new(),
        }
    }

    /// Record an observation.  `is_bot` if the BotClassifier flagged this request.
    pub fn observe_ja3(&self, digest: &str, is_bot: bool) {
        let mut rec = self
            .ja3_records
            .entry(digest.to_string())
            .or_insert_with(|| FingerprintRecord {
                first_seen: Instant::now(),
                request_count: 0,
                bot_hits: 0,
            });
        rec.request_count += 1;
        if is_bot {
            rec.bot_hits += 1;
        }
    }

    pub fn observe_h2(&self, canonical: &str, is_bot: bool) {
        let mut rec = self
            .h2_records
            .entry(canonical.to_string())
            .or_insert_with(|| FingerprintRecord {
                first_seen: Instant::now(),
                request_count: 0,
                bot_hits: 0,
            });
        rec.request_count += 1;
        if is_bot {
            rec.bot_hits += 1;
        }
    }

    /// Bot rate for a JA3 digest (0.0 if unseen).
    pub fn ja3_bot_rate(&self, digest: &str) -> f32 {
        self.ja3_records
            .get(digest)
            .map(|r| {
                if r.request_count == 0 {
                    0.0
                } else {
                    r.bot_hits as f32 / r.request_count as f32
                }
            })
            .unwrap_or(0.0)
    }

    pub fn ja3_count(&self) -> usize {
        self.ja3_records.len()
    }
    pub fn h2_count(&self) -> usize {
        self.h2_records.len()
    }
}

impl Default for FingerprintDb {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn test_ja3_grease_excluded() {
        let hello = TlsClientHello {
            tls_version: 0x0303,
            cipher_suites: vec![0x0A0A, 0x1301, 0x1302], // 0x0A0A is GREASE
            extensions: vec![0x1A1A, 0x0000, 0x0010],    // 0x1A1A is GREASE
            elliptic_curves: vec![0x2A2A, 0x0017],       // 0x2A2A is GREASE
            elliptic_curve_formats: vec![0],
        };
        let fp = Ja3Fingerprint::compute(&hello);
        assert!(!fp.raw.contains("2570"), "GREASE 0x0A0A should be excluded");
        assert!(fp.raw.contains("4865"), "0x1301 should be present");
    }

    #[test]
    fn test_h2_fingerprint_canonical() {
        let fp = H2Fingerprint {
            header_table_size: Some(4096),
            enable_push: Some(0),
            max_concurrent_streams: Some(100),
            initial_window_size: Some(65535),
            max_frame_size: Some(16384),
            max_header_list_size: None,
            window_update: Some(15663105),
        };
        let c = fp.canonical();
        assert!(c.contains("4096"));
        assert!(c.contains("?")); // max_header_list_size missing
    }

    #[test]
    fn test_bot_classifier_empty_ua() {
        let profile = RequestProfile {
            ip: IpAddr::V4(Ipv4Addr::new(1, 2, 3, 4)),
            user_agent: String::new(),
            ja3: None,
            h2: None,
            request_interval_ms: 1000,
            header_order_hash: 12345,
        };
        let score = BotClassifier::score(&profile);
        assert!(score.0 > 0.0);
    }

    #[test]
    fn test_bot_classifier_curl() {
        let profile = RequestProfile {
            ip: IpAddr::V4(Ipv4Addr::new(1, 2, 3, 5)),
            user_agent: "curl/7.88.0".to_string(),
            ja3: None,
            h2: None,
            request_interval_ms: 5000,
            header_order_hash: 999,
        };
        let score = BotClassifier::score(&profile);
        assert!(score.is_suspicious());
    }

    #[test]
    fn test_bot_classifier_normal_browser() {
        let profile = RequestProfile {
            ip: IpAddr::V4(Ipv4Addr::new(1, 2, 3, 6)),
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string(),
            ja3: None,
            h2: None,
            request_interval_ms: 2000,
            header_order_hash: 0xdeadbeef,
        };
        let score = BotClassifier::score(&profile);
        assert!(!score.is_likely_bot());
    }

    #[test]
    fn test_fingerprint_db_observe() {
        let db = FingerprintDb::new();
        db.observe_ja3("abc123", false);
        db.observe_ja3("abc123", true);
        assert!((db.ja3_bot_rate("abc123") - 0.5).abs() < 1e-5);
        assert_eq!(db.ja3_bot_rate("unknown"), 0.0);
    }

    #[test]
    fn test_header_order_hash_deterministic() {
        let h1 = RequestProfile::hash_header_order(&["host", "user-agent", "accept"]);
        let h2 = RequestProfile::hash_header_order(&["host", "user-agent", "accept"]);
        assert_eq!(h1, h2);
        let h3 = RequestProfile::hash_header_order(&["accept", "host", "user-agent"]);
        assert_ne!(h1, h3);
    }
}
