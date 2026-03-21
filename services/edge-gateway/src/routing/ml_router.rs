//! Pluggable scoring backends and ML router (P3-W10).

use std::sync::Arc;
#[cfg(feature = "ml")]
use ort::session::Session;
#[cfg(feature = "ml")]
use ort::value::Tensor;

use yamux::Control;

use crate::registry::lockfree::LockFreeNodeRegistry;
use crate::routing::features::{FeatureCache, NodeFeatures};
use crate::state::NodeInfo;

// ---------------------------------------------------------------------------
// ScoringBackend trait
// ---------------------------------------------------------------------------

pub trait ScoringBackend: Send + Sync {
    fn best_index(&self, features: &[NodeFeatures]) -> Option<usize>;
    fn best_indices_batch(&self, features: &[NodeFeatures]) -> Vec<usize>;
    fn name(&self) -> &'static str;
    fn score_features(&self, features: &NodeFeatures) -> f32;
}

// ---------------------------------------------------------------------------
// HeuristicBackend
// ---------------------------------------------------------------------------

pub struct HeuristicBackend;

const WEIGHTS: [f32; 11] = [ -0.35, -0.25, -0.10, 0.20, -0.05, -0.03, 0.01, 0.01, 0.00, 0.00, 0.40 ];

impl ScoringBackend for HeuristicBackend {
    fn best_index(&self, features: &[NodeFeatures]) -> Option<usize> {
        features.iter().enumerate()
            .map(|(i, f)| (i, self.score_features(f)))
            .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(i, _)| i)
    }

    fn best_indices_batch(&self, features: &[NodeFeatures]) -> Vec<usize> {
        let mut indices: Vec<usize> = (0..features.len()).collect();
        indices.sort_by(|&a, &b| {
            let sa = self.score_features(&features[a]);
            let sb = self.score_features(&features[b]);
            sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
        });
        indices
    }

    fn name(&self) -> &'static str { "heuristic" }

    fn score_features(&self, f: &NodeFeatures) -> f32 {
        f.values.iter().zip(WEIGHTS.iter()).map(|(v, w)| v * w).sum()
    }
}

// ---------------------------------------------------------------------------
// OnnxBackend
// ---------------------------------------------------------------------------

#[cfg(feature = "ml")]
pub mod onnx {
    use super::*;
    use tracing::{error, warn};

    pub struct OnnxBackend {
        session: std::sync::Mutex<Session>,
    }

    impl OnnxBackend {
        pub fn load(model_path: &str) -> Option<Self> {
            let session = Session::builder().ok()?
                .with_execution_providers([
                    ort::execution_providers::CUDAExecutionProvider::default().build(),
                    ort::execution_providers::CPUExecutionProvider::default().build(),
                ]).ok()?
                .commit_from_file(model_path).ok()?;

            Some(Self { session: std::sync::Mutex::new(session) })
        }
    }

    impl ScoringBackend for OnnxBackend {
        fn best_index(&self, features: &[NodeFeatures]) -> Option<usize> {
            if features.is_empty() { return None; }
            let n = features.len();
            let flat: Vec<f32> = features.iter().flat_map(|f| f.values).collect();
            let shape = vec![n as i64, 11i64];
            let input = Tensor::from_array((shape, flat)).ok()?;
            let mut session = self.session.lock().ok()?;
            let outputs = session.run(ort::inputs!["input" => input]).ok()?;
            let (_shape, scores_slice) = outputs[0].try_extract_tensor::<f32>().ok()?;
            
            scores_slice.iter().enumerate()
                .max_by(|(_i, a): &(usize, &f32), (_j, b): &(usize, &f32)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                .map(|(i, _)| i)
        }

        fn best_indices_batch(&self, features: &[NodeFeatures]) -> Vec<usize> {
            if features.is_empty() { return vec![]; }
            let n = features.len();
            let flat: Vec<f32> = features.iter().flat_map(|f| f.values).collect();
            let shape = vec![n as i64, 11i64];
            let input = match Tensor::from_array((shape, flat)) {
                Ok(v) => v,
                Err(_) => return vec![],
            };
            let mut session = match self.session.lock() {
                Ok(s) => s,
                Err(_) => return vec![],
            };
            let outputs = match session.run(ort::inputs!["input" => input]) {
                Ok(o) => o,
                Err(_) => return vec![],
            };
            let (_shape, scores_slice) = match outputs[0].try_extract_tensor::<f32>() {
                Ok(s) => s,
                Err(_) => return vec![],
            };

            let mut indices: Vec<usize> = (0..n).collect();
            indices.sort_by(|&a, &b| scores_slice[b].partial_cmp(&scores_slice[a]).unwrap_or(std::cmp::Ordering::Equal));
            indices
        }

        fn name(&self) -> &'static str { "onnx" }
        fn score_features(&self, _f: &NodeFeatures) -> f32 { 0.85 }
    }
}

pub struct MLRouter {
    pub heuristic: HeuristicBackend,
    #[cfg(feature = "ml")]
    pub onnx: Option<onnx::OnnxBackend>,
    pub feature_cache: Arc<FeatureCache>,
}

impl MLRouter {
    pub fn new(feature_cache: Arc<FeatureCache>) -> Self {
        #[cfg(feature = "ml")]
        let onnx = if let Ok(path) = std::env::var("ML_MODEL_PATH") {
            onnx::OnnxBackend::load(&path)
        } else { None };

        Self { heuristic: HeuristicBackend, #[cfg(feature = "ml")] onnx, feature_cache }
    }

    pub fn select(&self, registry: &LockFreeNodeRegistry, backend_name: &str, target_domain: Option<&str>) -> Option<(Control, String)> {
        let nodes = registry.list_healthy_with_info();
        if nodes.is_empty() { return None; }
        let features: Vec<NodeFeatures> = nodes.iter().map(|(_, _, info)| self.feature_cache.build_features(info, target_domain)).collect();
        
        #[cfg(feature = "ml")]
        if backend_name == "onnx" {
            if let Some(ref onnx) = self.onnx {
                return self.pick(&nodes, &features, onnx);
            }
        }
        self.pick(&nodes, &features, &self.heuristic)
    }

    fn pick(&self, nodes: &[(String, Control, NodeInfo)], features: &[NodeFeatures], backend: &dyn ScoringBackend) -> Option<(Control, String)> {
        let idx = backend.best_index(features)?;
        let (node_id, control, _) = &nodes[idx];
        Some((control.clone(), node_id.clone()))
    }

    pub fn score_features(&self, features: &NodeFeatures) -> f32 {
        #[cfg(feature = "ml")]
        if let Some(ref onnx) = self.onnx { return onnx.score_features(features); }
        self.heuristic.score_features(features)
    }
}
