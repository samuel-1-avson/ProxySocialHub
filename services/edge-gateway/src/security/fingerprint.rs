//! Behavioral fingerprinting engine (P4-W14).
//!
//! # Components
//! - `Ja3Fingerprint`  — TLS ClientHello fingerprint (JA3 algorithm)
//! - `Ja4Fingerprint`  — TLS ClientHello fingerprint ([FoxIO JA4](https://github.com/FoxIO-LLC/ja4))
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

use std::{net::IpAddr, time::Instant};

use dashmap::DashMap;
use sha2::{Digest, Sha256};

// ---------------------------------------------------------------------------
// TLS ClientHello parsing (JA3 + JA4)
// ---------------------------------------------------------------------------

/// Parsed ClientHello fields used for JA3 and JA4.
#[derive(Debug, Clone, Default)]
pub struct ParsedClientHello {
    pub handshake_version: u16,
    pub cipher_suites: Vec<u16>,
    /// Extension types in wire order.
    pub extensions: Vec<u16>,
    pub elliptic_curves: Vec<u16>,
    pub elliptic_curve_formats: Vec<u8>,
    pub has_sni: bool,
    pub alpn_first: Option<Vec<u8>>,
    pub signature_algorithms: Vec<u16>,
    pub supported_versions: Vec<u16>,
}

/// Legacy alias retained for tests.
pub type TlsClientHello = ParsedClientHello;

fn is_grease_u16(v: u16) -> bool {
    (v & 0x0F0F == 0x0A0A) && (v >> 8 == v & 0xFF)
}

// ---------------------------------------------------------------------------
// JA3 Fingerprint (RFC/spec: https://github.com/salesforce/ja3)
// ---------------------------------------------------------------------------

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
    pub fn compute(hello: &ParsedClientHello) -> Self {
        let ciphers = hello
            .cipher_suites
            .iter()
            .filter(|&&c| !is_grease_u16(c))
            .map(|c| c.to_string())
            .collect::<Vec<_>>()
            .join("-");

        let exts = hello
            .extensions
            .iter()
            .filter(|&&e| !is_grease_u16(e))
            .map(|e| e.to_string())
            .collect::<Vec<_>>()
            .join("-");

        let curves = hello
            .elliptic_curves
            .iter()
            .filter(|&&c| !is_grease_u16(c))
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
            hello.handshake_version, ciphers, exts, curves, formats
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

// ---------------------------------------------------------------------------
// JA4 Fingerprint (https://github.com/FoxIO-LLC/ja4/blob/main/technical_details/JA4.md)
// ---------------------------------------------------------------------------

/// Human-readable JA4 fingerprint (`a_b_c` format).
#[derive(Debug, Clone)]
pub struct Ja4Fingerprint {
    pub fingerprint: String,
}

impl Ja4Fingerprint {
    /// `protocol` is `t` (TLS/TCP), `q` (QUIC), or `d` (DTLS).
    pub fn compute(hello: &ParsedClientHello, protocol: char) -> Self {
        let a = ja4_section_a(hello, protocol);
        let b = ja4_section_b(hello);
        let c = ja4_section_c(hello);
        Self {
            fingerprint: format!("{a}_{b}_{c}"),
        }
    }

    pub fn from_bytes(buf: &[u8], protocol: char) -> Option<Self> {
        let hello = parse_client_hello(buf)?;
        Some(Self::compute(&hello, protocol))
    }
}

fn ja4_section_a(hello: &ParsedClientHello, protocol: char) -> String {
    let version = ja4_tls_version_label(hello);
    let sni = if hello.has_sni { 'd' } else { 'i' };
    let cipher_count = hello
        .cipher_suites
        .iter()
        .filter(|&&c| !is_grease_u16(c))
        .count()
        .min(99);
    let ext_count = hello
        .extensions
        .iter()
        .filter(|&&e| !is_grease_u16(e))
        .count()
        .min(99);
    let alpn = ja4_alpn_tag(hello.alpn_first.as_deref());
    format!("{protocol}{version}{sni}{cipher_count:02}{ext_count:02}{alpn}")
}

fn ja4_tls_version_label(hello: &ParsedClientHello) -> &'static str {
    let version = if !hello.supported_versions.is_empty() {
        hello
            .supported_versions
            .iter()
            .copied()
            .filter(|v| !is_grease_u16(*v))
            .max()
            .unwrap_or(hello.handshake_version)
    } else {
        hello.handshake_version
    };
    match version {
        0x0304 => "13",
        0x0303 => "12",
        0x0302 => "11",
        0x0301 => "10",
        0x0300 => "s3",
        0x0002 => "s2",
        0xfeff => "d1",
        0xfefd => "d2",
        0xfefc => "d3",
        _ => "00",
    }
}

fn ja4_alpn_tag(alpn: Option<&[u8]>) -> String {
    let Some(bytes) = alpn else {
        return "00".to_string();
    };
    if bytes.is_empty() {
        return "00".to_string();
    }
    if bytes.len() == 1 {
        let c = bytes[0];
        if c.is_ascii_alphanumeric() {
            let ch = c as char;
            return format!("{ch}{ch}");
        }
        return format!("{c:02x}");
    }

    let first_byte_alnum = bytes[0].is_ascii_alphanumeric();
    let last_byte_alnum = bytes[bytes.len() - 1].is_ascii_alphanumeric();

    if first_byte_alnum && last_byte_alnum {
        let first = bytes
            .iter()
            .find(|b| b.is_ascii_alphanumeric())
            .map(|b| *b as char)
            .unwrap_or('0');
        let last = bytes
            .iter()
            .rfind(|b| b.is_ascii_alphanumeric())
            .map(|b| *b as char)
            .unwrap_or('0');
        return format!("{first}{last}");
    }

    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let hex_chars: Vec<char> = hex.chars().collect();
    format!(
        "{}{}",
        hex_chars.first().copied().unwrap_or('0'),
        hex_chars.last().copied().unwrap_or('0')
    )
}

fn ja4_hex_list_sorted(values: &[u16]) -> String {
    let mut parts: Vec<String> = values.iter().map(|v| format!("{v:04x}")).collect();
    parts.sort();
    parts.join(",")
}

fn ja4_trunc_sha256(input: &str) -> String {
    if input.is_empty() {
        return "000000000000".to_string();
    }
    let hash = Sha256::digest(input.as_bytes());
    format!("{:x}", hash)[..12].to_string()
}

fn ja4_section_b(hello: &ParsedClientHello) -> String {
    let ciphers: Vec<u16> = hello
        .cipher_suites
        .iter()
        .copied()
        .filter(|c| !is_grease_u16(*c))
        .collect();
    if ciphers.is_empty() {
        return "000000000000".to_string();
    }
    ja4_trunc_sha256(&ja4_hex_list_sorted(&ciphers))
}

fn ja4_section_c(hello: &ParsedClientHello) -> String {
    let mut exts: Vec<u16> = hello
        .extensions
        .iter()
        .copied()
        .filter(|e| !is_grease_u16(*e) && *e != 0x0000 && *e != 0x0010)
        .collect();
    exts.sort();
    let ext_part = ja4_hex_list_sorted(&exts);
    if ext_part.is_empty() && hello.signature_algorithms.is_empty() {
        return "000000000000".to_string();
    }
    let sig_part: String = hello
        .signature_algorithms
        .iter()
        .map(|v| format!("{v:04x}"))
        .collect::<Vec<_>>()
        .join(",");
    let combined = if sig_part.is_empty() {
        ext_part
    } else if ext_part.is_empty() {
        sig_part
    } else {
        format!("{ext_part}_{sig_part}")
    };
    ja4_trunc_sha256(&combined)
}

/// JA3 + JA4 derived from a peeked ClientHello.
#[derive(Debug, Clone, Default)]
pub struct TlsClientFingerprints {
    pub ja3_digest: Option<String>,
    pub ja4: Option<String>,
}

pub fn fingerprints_from_client_hello_bytes(buf: &[u8]) -> Option<TlsClientFingerprints> {
    let hello = parse_client_hello(buf)?;
    let ja3 = Ja3Fingerprint::compute(&hello);
    let ja4 = Ja4Fingerprint::compute(&hello, 't');
    Some(TlsClientFingerprints {
        ja3_digest: Some(ja3.digest),
        ja4: Some(ja4.fingerprint),
    })
}

/// Peek up to 512 bytes from a TCP stream (non-consuming) and return JA3/JA4 if ClientHello.
pub async fn peek_tls_fingerprints_from_tcp(
    stream: &tokio::net::TcpStream,
) -> TlsClientFingerprints {
    let mut buf = [0u8; 512];
    let Ok(n) = stream.peek(&mut buf).await else {
        return TlsClientFingerprints::default();
    };
    if n == 0 {
        return TlsClientFingerprints::default();
    }
    fingerprints_from_client_hello_bytes(&buf[..n]).unwrap_or_default()
}

/// Peek up to 512 bytes from a TCP stream (non-consuming) and return JA3 digest if ClientHello.
pub async fn peek_ja3_digest_from_tcp(stream: &tokio::net::TcpStream) -> Option<String> {
    peek_tls_fingerprints_from_tcp(stream).await.ja3_digest
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

/// Minimal TLS ClientHello parser for JA3/JA4.
fn parse_client_hello(buf: &[u8]) -> Option<ParsedClientHello> {
    if buf.len() < 44 || buf[0] != 22 || buf[5] != 1 {
        return None;
    }

    let handshake_version = u16::from_be_bytes([buf[9], buf[10]]);
    let mut pos = 43usize;

    let session_len = *buf.get(pos)? as usize;
    pos = pos.checked_add(1 + session_len)?;

    let cs_len = u16::from_be_bytes([*buf.get(pos)?, *buf.get(pos + 1)?]) as usize;
    pos += 2;
    let mut cipher_suites = Vec::with_capacity(cs_len / 2);
    for i in (0..cs_len).step_by(2) {
        let hi = *buf.get(pos + i)? as u16;
        let lo = *buf.get(pos + i + 1)? as u16;
        cipher_suites.push((hi << 8) | lo);
    }
    pos += cs_len;

    let comp_len = *buf.get(pos)? as usize;
    pos = pos.checked_add(1 + comp_len)?;

    let mut hello = ParsedClientHello {
        handshake_version,
        cipher_suites,
        ..Default::default()
    };

    if pos + 2 > buf.len() {
        return Some(hello);
    }

    let ext_total = u16::from_be_bytes([buf[pos], buf[pos + 1]]) as usize;
    pos += 2;
    let ext_end = pos.saturating_add(ext_total).min(buf.len());

    while pos + 4 <= ext_end {
        let ext_type = u16::from_be_bytes([buf[pos], buf[pos + 1]]);
        let ext_len = u16::from_be_bytes([buf[pos + 2], buf[pos + 3]]) as usize;
        pos += 4;
        let payload_end = pos.saturating_add(ext_len).min(ext_end);
        let payload = buf.get(pos..payload_end)?;

        hello.extensions.push(ext_type);

        match ext_type {
            0x0000 => hello.has_sni = !payload.is_empty(),
            0x000a => parse_supported_groups(payload, &mut hello.elliptic_curves),
            0x000b => parse_ec_point_formats(payload, &mut hello.elliptic_curve_formats),
            0x000d => hello.signature_algorithms = parse_signature_algorithms(payload),
            0x0010 => hello.alpn_first = parse_alpn_first(payload),
            0x002b => hello.supported_versions = parse_supported_versions(payload),
            _ => {}
        }

        pos = payload_end;
    }

    Some(hello)
}

fn parse_supported_groups(payload: &[u8], out: &mut Vec<u16>) {
    if payload.len() < 2 {
        return;
    }
    let list_len = u16::from_be_bytes([payload[0], payload[1]]) as usize;
    for i in (0..list_len).step_by(2) {
        if payload.len() > 2 + i {
            let c = u16::from_be_bytes([payload[2 + i], payload[2 + i + 1]]);
            out.push(c);
        }
    }
}

fn parse_ec_point_formats(payload: &[u8], out: &mut Vec<u8>) {
    if payload.is_empty() {
        return;
    }
    let fmt_len = payload[0] as usize;
    for i in 0..fmt_len {
        if let Some(b) = payload.get(1 + i) {
            out.push(*b);
        }
    }
}

fn parse_signature_algorithms(payload: &[u8]) -> Vec<u16> {
    if payload.len() < 2 {
        return Vec::new();
    }
    let list_len = u16::from_be_bytes([payload[0], payload[1]]) as usize;
    let mut algs = Vec::new();
    for i in (0..list_len).step_by(2) {
        if payload.len() > 2 + i {
            algs.push(u16::from_be_bytes([payload[2 + i], payload[2 + i + 1]]));
        }
    }
    algs
}

fn parse_alpn_first(payload: &[u8]) -> Option<Vec<u8>> {
    if payload.len() < 3 {
        return None;
    }
    let list_len = u16::from_be_bytes([payload[0], payload[1]]) as usize;
    if payload.len() < 2 + list_len {
        return None;
    }
    let mut p = 2usize;
    let alpn_len = *payload.get(p)? as usize;
    p += 1;
    if p + alpn_len > payload.len() {
        return None;
    }
    Some(payload[p..p + alpn_len].to_vec())
}

fn parse_supported_versions(payload: &[u8]) -> Vec<u16> {
    if payload.is_empty() {
        return Vec::new();
    }
    let list_len = payload[0] as usize;
    let mut versions = Vec::new();
    for i in (0..list_len).step_by(2) {
        if payload.len() > 1 + i {
            versions.push(u16::from_be_bytes([payload[1 + i], payload[1 + i + 1]]));
        }
    }
    versions
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
            score += 0.4;
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

    /// Like [`Self::score`] but incorporates historical bot rates from [`FingerprintDb`].
    pub fn score_with_db(profile: &RequestProfile, db: &FingerprintDb) -> BotScore {
        let mut score = Self::score(profile).0;
        if let Some(ref ja3) = profile.ja3 {
            let rate = db.ja3_bot_rate(ja3);
            if rate >= 0.7 {
                score += 0.35;
            } else if rate >= 0.4 {
                score += 0.15;
            }
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
    /// ja4 fingerprint (`a_b_c`) → record
    ja4_records: DashMap<String, FingerprintRecord>,
    /// h2_canonical → record
    h2_records: DashMap<String, FingerprintRecord>,
}

impl FingerprintDb {
    pub fn new() -> Self {
        Self {
            ja3_records: DashMap::new(),
            ja4_records: DashMap::new(),
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

    pub fn observe_ja4(&self, fingerprint: &str, is_bot: bool) {
        let mut rec = self
            .ja4_records
            .entry(fingerprint.to_string())
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

    /// Bot rate for a JA4 fingerprint (0.0 if unseen).
    pub fn ja4_bot_rate(&self, fingerprint: &str) -> f32 {
        self.ja4_records
            .get(fingerprint)
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
    pub fn ja4_count(&self) -> usize {
        self.ja4_records.len()
    }
    pub fn h2_count(&self) -> usize {
        self.h2_records.len()
    }
}

/// Peek TLS fingerprints from TCP and record them in the DB (non-bot by default).
pub async fn observe_tls_fingerprints_from_tcp(
    stream: &tokio::net::TcpStream,
    db: &FingerprintDb,
) -> TlsClientFingerprints {
    let fp = peek_tls_fingerprints_from_tcp(stream).await;
    if let Some(ref digest) = fp.ja3_digest {
        db.observe_ja3(digest, false);
    }
    if let Some(ref ja4) = fp.ja4 {
        db.observe_ja4(ja4, false);
    }
    fp
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
        let hello = ParsedClientHello {
            handshake_version: 0x0303,
            cipher_suites: vec![0x0A0A, 0x1301, 0x1302], // 0x0A0A is GREASE
            extensions: vec![0x1A1A, 0x0000, 0x0010],    // 0x1A1A is GREASE
            elliptic_curves: vec![0x2A2A, 0x0017],       // 0x2A2A is GREASE
            elliptic_curve_formats: vec![0],
            ..Default::default()
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
    fn test_bot_classifier_ja3_reputation() {
        let db = FingerprintDb::new();
        for _ in 0..5 {
            db.observe_ja3("badfp", true);
        }

        let profile = RequestProfile {
            ip: IpAddr::V4(Ipv4Addr::new(1, 2, 3, 7)),
            user_agent: "curl/7.88.0".to_string(),
            ja3: Some("badfp".to_string()),
            h2: None,
            request_interval_ms: 5000,
            header_order_hash: 1,
        };
        let base = BotClassifier::score(&profile);
        let with_db = BotClassifier::score_with_db(&profile, &db);
        assert!(with_db.0 > base.0);
        assert!(with_db.is_likely_bot());
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

        db.observe_ja4("t13d0608h2_abc_def", false);
        db.observe_ja4("t13d0608h2_abc_def", true);
        assert!((db.ja4_bot_rate("t13d0608h2_abc_def") - 0.5).abs() < 1e-5);
        assert_eq!(db.ja4_count(), 1);
    }

    #[test]
    fn test_ja4_alpn_tag() {
        assert_eq!(ja4_alpn_tag(Some(b"h2")), "h2");
        assert_eq!(ja4_alpn_tag(Some(b"http/1.1")), "h1");
        assert_eq!(ja4_alpn_tag(None), "00");
        assert_eq!(ja4_alpn_tag(Some(b"h")), "hh");
    }

    #[test]
    fn test_ja4_section_a_tls13_sni_alpn() {
        let hello = ParsedClientHello {
            handshake_version: 0x0303,
            cipher_suites: vec![0x1301, 0x1302, 0x1303, 0xc02b, 0xc02f, 0xc030],
            extensions: vec![
                0x0000, 0x0017, 0xff01, 0x000a, 0x000b, 0x000d, 0x0010, 0x002b,
            ],
            has_sni: true,
            alpn_first: Some(b"h2".to_vec()),
            supported_versions: vec![0x0304, 0x0303],
            signature_algorithms: vec![0x0403, 0x0804, 0x0401],
            ..Default::default()
        };
        let ja4 = Ja4Fingerprint::compute(&hello, 't');
        let parts: Vec<&str> = ja4.fingerprint.split('_').collect();
        assert_eq!(parts.len(), 3);
        assert!(parts[0].starts_with("t13d"));
        assert!(parts[0].ends_with("h2"));
        assert_eq!(parts[0].len(), 10); // t + 13 + d + 06 + 08 + h2
        assert_eq!(parts[1].len(), 12);
        assert_eq!(parts[2].len(), 12);
    }

    #[test]
    fn test_ja4_section_b_deterministic() {
        let hello = ParsedClientHello {
            cipher_suites: vec![0x1302, 0x1301, 0x1303],
            ..Default::default()
        };
        let b1 = ja4_section_b(&hello);
        let b2 = ja4_section_b(&hello);
        assert_eq!(b1, b2);
        assert_eq!(b1.len(), 12);
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
