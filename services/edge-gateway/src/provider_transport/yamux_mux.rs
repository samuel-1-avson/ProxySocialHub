//! Round-robin sharding across multiple yamux `Control` handles per provider node.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::RwLock;
use yamux::Control;

/// Maximum parallel yamux lanes per provider (hard cap).
pub const MAX_YAMUX_LANES: usize = 16;

#[derive(Debug)]
pub struct YamuxMux {
    lanes: RwLock<Vec<Control>>,
    next: AtomicUsize,
    max_lanes: usize,
}

impl YamuxMux {
    pub fn normalize_max_lanes(max_lanes: usize) -> usize {
        max_lanes.max(1).min(MAX_YAMUX_LANES)
    }

    pub fn new(control: Control, max_lanes: usize) -> Self {
        Self {
            lanes: RwLock::new(vec![control]),
            next: AtomicUsize::new(0),
            max_lanes: Self::normalize_max_lanes(max_lanes),
        }
    }

    /// Attach another yamux control from a second provider TCP connection.
    pub fn try_add(&self, control: Control) -> bool {
        let mut lanes = match self.lanes.write() {
            Ok(guard) => guard,
            Err(_) => return false,
        };
        if lanes.len() >= self.max_lanes {
            return false;
        }
        lanes.push(control);
        true
    }

    /// Pick a lane for opening a new stream (round-robin).
    pub fn pick_control(&self) -> Option<Control> {
        let lanes = self.lanes.read().ok()?;
        if lanes.is_empty() {
            return None;
        }
        let idx = self.next.fetch_add(1, Ordering::Relaxed) % lanes.len();
        Some(lanes[idx].clone())
    }

    /// First lane — used for score snapshots and stable routing hints.
    pub fn primary(&self) -> Option<Control> {
        self.lanes.read().ok()?.first().cloned()
    }

    pub fn lane_count(&self) -> usize {
        self.lanes.read().map(|v| v.len()).unwrap_or(0)
    }

    pub fn max_lanes(&self) -> usize {
        self.max_lanes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_max_lanes() {
        assert_eq!(YamuxMux::normalize_max_lanes(0), 1);
        assert_eq!(YamuxMux::normalize_max_lanes(1), 1);
        assert_eq!(YamuxMux::normalize_max_lanes(99), MAX_YAMUX_LANES);
    }
}
