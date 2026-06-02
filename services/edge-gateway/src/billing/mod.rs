//! Billing Module (Phase 5).
//!
//! Legacy edge-side ZK proving and Solana submission live behind the `legacy-zk`
//! feature. Canonical settlement is handled by control-api batching.

#[cfg(feature = "legacy-zk")]
pub mod solana;
#[cfg(feature = "legacy-zk")]
pub mod zk;
