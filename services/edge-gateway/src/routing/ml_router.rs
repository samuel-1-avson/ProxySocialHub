//! Pluggable scoring backends and ML router (P3-W10).
//!
//! # Architecture
//! ```text
//! MLRouter::select()
//!   └─ AbTestCoordinator decides which backend to invoke
//!        ├─ HeuristicBackend  — weighted multi-factor, always available
//!        └─ OnnxBackend       — ONNX Runtime inference (feature = "ml")
//! ```
//!
//! `ScoringBackend` is a trait so backends can be swapped at runtime or
//! replaced with a mock in tests.

use std::sync::Arc;

use yamux::Control;

use crate::registry::lockfree::LockFreeNodeRegistry;
use crate::routing::features::{FeatureCache, NodeFeatures};
use crate::state::NodeInfo;

// ---------------------------------------------------------------------------
// ScoringBackend trait
// ---------------------------------------------------------------------------

/// A backend that scores a slice of candidate nodes and returns the best index.
pub trait ScoringBackend: Send + Sync {
    /// Score `candidates` and return the index of the best node.
    /// Returns `None` if the candidate list is empty.
    fn best_index(&self, features: &[NodeFeatures]) -> Option<usize>;

    /// Human-readable name for observability / A/B-test labelling.
    fn name(&self) -> &'static str;
}

// ---------------------------------------------------------------------------
// HeuristicBackend — always available
// ---------------------------------------------------------------------------

/// Weighted multi-factor heuristic scorer.
///
/// Score = Σ wᵢ · feature[i], where weights are tuned for low-latency routing:
///
/// | idx | feature              | weight |
/// |-----|----------------------|--------|
/// |  0  | latency (inverted)   | +0.35  |
/// |  1  | connection_load (inv)| +0.25  |
/// |  2  | bw_util (inverted)   | +0.10  |
/// |  3  | historical_success   | +0.20  |
/// |  4  | avg_latency_hist(inv)| +0.05  |
/// |  5  | packet_loss (inverted| +0.03  |
/// |  6  | bytes_served_log     | +0.01  |
/// |  7  | uptime_norm          | +0.01  |
/// |  8  | health_flag          | +0.00  | (handled via filter, not score)
/// |  9  | region_hash          | +0.00  | (geo-matching done in registry)
pub struct HeuristicBackend;

/// Weights for each feature dimension.  Must sum to ≤ 1.0.
const WEIGHTS: [f32; 10] = [
    -0.35, // latency — lower is better → negative weight
    -0.25, // connection_load — lower is better
    -0.10, // bw_util — lower is better
    0.20, // historical_success — higher is better
    -0.05, // avg_latency_hist — lower is better
    -0.03, // packet_loss — lower is better
    0.01, // bytes_served_log
    0.01, // uptime_norm
    0.00, // health_flag (filtering, not scoring)
    0.00, // region_hash (geo filter in registry)
];

impl ScoringBackend for HeuristicBackend {
    fn best_index(&self, features: &[NodeFeatures]) -> Option<usize> {
        features
            .iter()
            .enumerate()
            .map(|(i, f)| {
                let score: f32 = f
                    .values
                    .iter()
                    .zip(WEIGHTS.iter())
                    .map(|(v, w)| v * w)
                    .sum();
                (i, score)
            })
            .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(i, _)| i)
    }

    fn name(&self) -> &'static str {
        "heuristic"
    }
}

// ---------------------------------------------------------------------------
// OnnxBackend — feature-gated behind `ml`
// ---------------------------------------------------------------------------

#[cfg(feature = "ml")]
pub mod onnx {
    use super::{NodeFeatures, ScoringBackend};
    use ort::{Environment, Session, SessionBuilder, Value};
    use std::sync::Arc;
    use tracing::{error, warn};

    /// ONNX Runtime scoring backend.
    ///
    /// Loads a pre-trained `.onnx` model that accepts a 2-D float32 input of
    /// shape `[N, 10]` (N candidates × 10 features) and produces a 1-D float32
    /// output of shape `[N]` (score per candidate, higher = better).
    pub struct OnnxBackend {
        session: Arc<Session>,
    }

    impl OnnxBackend {
        /// Load a model from `model_path`.  Returns `None` if loading fails so
        /// the caller can fall back to the heuristic backend.
        pub fn load(env: Arc<Environment>, model_path: &str) -> Option<Self> {
            match SessionBuilder::new(&env)
                .and_then(|b| b.with_model_from_file(model_path))
            {
                Ok(session) => Some(Self {
                    session: Arc::new(session),
                }),
                Err(e) => {
                    warn!("ONNX model load failed ({}): {}", model_path, e);
                    None
                }
            }
        }
    }

    impl ScoringBackend for OnnxBackend {
        fn best_index(&self, features: &[NodeFeatures]) -> Option<usize> {
            if features.is_empty() {
                return None;
            }
            let n = features.len();
            // Flatten to [n, 10] row-major
            let flat: Vec<f32> = features.iter().flat_map(|f| f.values).collect();

            let input = match Value::from_array(([n, 10], flat.as_slice())) {
                Ok(v) => v,
                Err(e) => {
                    error!("ONNX input build failed: {}", e);
                    return None;
                }
            };

            let outputs = match self.session.run(vec![input]) {
                Ok(o) => o,
                Err(e) => {
                    error!("ONNX inference failed: {}", e);
                    return None;
                }
            };

            let scores: &[f32] = match outputs[0].try_extract::<f32>() {
                Ok(s) => s.view().as_slice().unwrap_or(&[]),
                Err(_) => return None,
            };

            scores
                .iter()
                .enumerate()
                .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                .map(|(i, _)| i)
        }

        fn name(&self) -> &'static str {
            "onnx"
        }
    }
}

// ---------------------------------------------------------------------------
// MLRouter — selects best provider using a ScoringBackend
// ---------------------------------------------------------------------------

/// High-level router that wraps the registry + feature cache + scoring backend.
pub struct MLRouter {
    pub heuristic: HeuristicBackend,
    #[cfg(feature = "ml")]
    pub onnx: Option<onnx::OnnxBackend>,
    pub feature_cache: Arc<FeatureCache>,
}

impl MLRouter {
    pub fn new(feature_cache: Arc<FeatureCache>) -> Self {
        Self {
            heuristic: HeuristicBackend,
            #[cfg(feature = "ml")]
            onnx: None,
            feature_cache,
        }
    }

    /// Select the best provider using the given backend.
    ///
    /// Returns `(Control, node_id)` or `None` if no healthy providers exist.
    pub fn select(
        &self,
        registry: &LockFreeNodeRegistry,
        backend_name: &str,
    ) -> Option<(Control, String)> {
        let nodes = registry.list_healthy_with_info();
        if nodes.is_empty() {
            return None;
        }

        let features: Vec<NodeFeatures> = nodes
            .iter()
            .map(|(_, _, info)| self.feature_cache.build_features(info))
            .collect();

        let backend: &dyn ScoringBackend = {
            #[cfg(feature = "ml")]
            if backend_name == "onnx" {
                if let Some(ref onnx) = self.onnx {
                    return self.pick(&nodes, &features, onnx);
                }
            }
            &self.heuristic
        };

        self.pick(&nodes, &features, backend)
    }

    fn pick(
        &self,
        nodes: &[(String, Control, NodeInfo)],
        features: &[NodeFeatures],
        backend: &dyn ScoringBackend,
    ) -> Option<(Control, String)> {
        let idx = backend.best_index(features)?;
        let (node_id, control, _) = &nodes[idx];
        Some((control.clone(), node_id.clone()))
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_features(latency: f32, load: f32, success: f32) -> NodeFeatures {
        let mut f = NodeFeatures::default();
        f.values[0] = latency;
        f.values[1] = load;
        f.values[3] = success;
        f.values[8] = 1.0; // healthy
        f
    }

    #[test]
    fn test_heuristic_prefers_low_latency() {
        let h = HeuristicBackend;
        let candidates = vec![
            make_features(0.9, 0.5, 0.8), // high latency
            make_features(0.1, 0.5, 0.8), // low latency → winner
        ];
        assert_eq!(h.best_index(&candidates), Some(1));
    }

    #[test]
    fn test_heuristic_empty() {
        let h = HeuristicBackend;
        assert_eq!(h.best_index(&[]), None);
    }

    #[test]
    fn test_heuristic_prefers_high_success() {
        let h = HeuristicBackend;
        let candidates = vec![
            make_features(0.2, 0.3, 0.5), // lower success
            make_features(0.2, 0.3, 0.95), // higher success → winner
        ];
        assert_eq!(h.best_index(&candidates), Some(1));
    }

    #[test]
    fn test_heuristic_single_candidate() {
        let h = HeuristicBackend;
        let candidates = vec![make_features(0.5, 0.5, 0.8)];
        assert_eq!(h.best_index(&candidates), Some(0));
    }
}
