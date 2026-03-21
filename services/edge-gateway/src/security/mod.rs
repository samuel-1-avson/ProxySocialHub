//! Phase 4: Security & Production Hardening (Weeks 13–16).
//!
//! - `ddos`        — Adaptive rate limiting + behavioral scoring (P4-W13)
//! - `fingerprint` — JA3 / HTTP2 fingerprinting + bot classifier (P4-W14)
//! - `reputation`  — IP reputation store + geo-blocking (P4-W13/W14)

pub mod ddos;
pub mod fingerprint;
pub mod reputation;
pub mod honeytoken;
pub mod anomaly;
