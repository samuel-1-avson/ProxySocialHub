//! Phase 2 proxy protocol modules.
//!
//! - `http2`    — HTTP/2 auto-detecting connection builder (P2-W5)
//! - `websocket`— WebSocket upgrade + WS-to-TCP bridging (P2-W6)
//! - `zerocopy` — Efficient bidirectional stream bridge with byte tracking (P2-W7)

pub mod http2;
pub mod websocket;
pub mod zerocopy;
