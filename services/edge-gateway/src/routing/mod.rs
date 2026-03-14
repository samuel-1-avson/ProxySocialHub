//! Phase 3: ML-Based Routing & Intelligence (Weeks 9–12).
//!
//! - `features`  — Node feature vector extraction and caching (P3-W9)
//! - `ml_router` — Pluggable scoring backends: heuristic + optional ONNX (P3-W10)
//! - `ab_test`   — A/B test coordinator for ML vs heuristic routing (P3-W10)
//! - `prewarm`   — Predictive connection pre-warming (P3-W11)
//! - `analytics` — Rolling window analytics + Prometheus export (P3-W11)

pub mod ab_test;
pub mod analytics;
pub mod features;
pub mod ml_router;
pub mod prewarm;
