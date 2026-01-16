use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use yamux::Control;
use rand::seq::SliceRandom;
use serde::{Serialize, Deserialize};

/// Provider node metadata for intelligent routing
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NodeInfo {
    pub node_id: String,
    pub country_code: String,      // ISO 3166-1 alpha-2 (e.g., "GH", "NG", "KE")
    pub region: String,            // Region/city (e.g., "Accra", "Lagos")
    pub ip_address: String,
    pub connected_at: u64,         // Unix timestamp
    pub total_bytes_served: u64,
    pub active_connections: u32,
    pub max_connections: u32,
    pub latency_ms: u32,           // Last measured latency
    pub is_healthy: bool,
}

impl NodeInfo {
    pub fn new(node_id: String, ip_address: String) -> Self {
        Self {
            node_id,
            country_code: "GH".to_string(), // Default to Ghana
            region: "Unknown".to_string(),
            ip_address,
            connected_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            total_bytes_served: 0,
            active_connections: 0,
            max_connections: 100,
            latency_ms: 0,
            is_healthy: true,
        }
    }

    /// Calculate node score for selection (higher is better)
    pub fn score(&self) -> u32 {
        if !self.is_healthy {
            return 0;
        }

        let mut score = 1000u32;

        // Penalize high latency
        score = score.saturating_sub(self.latency_ms);

        // Penalize high load
        let load_percent = (self.active_connections * 100) / self.max_connections.max(1);
        score = score.saturating_sub(load_percent * 5);

        // Bonus for fresh nodes (connected recently)
        let uptime_hours = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() - self.connected_at) / 3600;
        if uptime_hours < 24 {
            score += 50; // Fresh node bonus
        }

        score
    }
}

/// Provider registry with health tracking and intelligent selection
pub struct NodeRegistry {
    nodes: HashMap<String, (Control, NodeInfo)>,
    health_check_interval: Duration,
}

impl NodeRegistry {
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            health_check_interval: Duration::from_secs(30),
        }
    }

    pub fn insert(&mut self, node_id: String, control: Control, info: NodeInfo) {
        println!("Registered node: {} from {} ({})", node_id, info.region, info.country_code);
        self.nodes.insert(node_id, (control, info));
    }

    pub fn insert_simple(&mut self, node_id: String, control: Control, ip_address: String) {
        let info = NodeInfo::new(node_id.clone(), ip_address);
        self.insert(node_id, control, info);
    }

    pub fn remove(&mut self, node_id: &str) {
        if let Some((_, info)) = self.nodes.remove(node_id) {
            println!("Removed node: {} from {}", node_id, info.region);
        }
    }

    pub fn count(&self) -> usize {
        self.nodes.len()
    }

    pub fn get_node_info(&self, node_id: &str) -> Option<&NodeInfo> {
        self.nodes.get(node_id).map(|(_, info)| info)
    }

    pub fn update_node_stats(&mut self, node_id: &str, bytes_served: u64) {
        if let Some((_, info)) = self.nodes.get_mut(node_id) {
            info.total_bytes_served += bytes_served;
        }
    }

    pub fn update_active_connections(&mut self, node_id: &str, delta: i32) {
        if let Some((_, info)) = self.nodes.get_mut(node_id) {
            if delta > 0 {
                info.active_connections = info.active_connections.saturating_add(delta as u32);
            } else {
                info.active_connections = info.active_connections.saturating_sub((-delta) as u32);
            }
        }
    }

    pub fn mark_unhealthy(&mut self, node_id: &str) {
        if let Some((_, info)) = self.nodes.get_mut(node_id) {
            info.is_healthy = false;
            println!("Marked node {} as unhealthy", node_id);
        }
    }

    pub fn mark_healthy(&mut self, node_id: &str) {
        if let Some((_, info)) = self.nodes.get_mut(node_id) {
            info.is_healthy = true;
        }
    }

    /// Get a random healthy node
    pub fn get_random(&self) -> Option<Control> {
        let healthy_nodes: Vec<_> = self.nodes.iter()
            .filter(|(_, (_, info))| info.is_healthy)
            .collect();
        
        if let Some((_, (control, _))) = healthy_nodes.choose(&mut rand::thread_rng()) {
            Some(control.clone())
        } else {
            None
        }
    }

    /// Get the best node based on scoring
    pub fn get_best(&self) -> Option<(Control, String)> {
        let mut best: Option<(&String, &Control, u32)> = None;

        for (id, (control, info)) in &self.nodes {
            if !info.is_healthy {
                continue;
            }

            let score = info.score();
            if let Some((_, _, best_score)) = best {
                if score > best_score {
                    best = Some((id, control, score));
                }
            } else {
                best = Some((id, control, score));
            }
        }

        best.map(|(id, control, _)| (control.clone(), id.clone()))
    }

    /// Get nodes filtered by country
    pub fn get_by_country(&self, country_code: &str) -> Option<Control> {
        let matching: Vec<_> = self.nodes.iter()
            .filter(|(_, (_, info))| info.is_healthy && info.country_code == country_code)
            .collect();
        
        if let Some((_, (control, _))) = matching.choose(&mut rand::thread_rng()) {
            Some(control.clone())
        } else {
            None
        }
    }

    /// Get nodes filtered by region
    pub fn get_by_region(&self, region: &str) -> Option<Control> {
        let matching: Vec<_> = self.nodes.iter()
            .filter(|(_, (_, info))| info.is_healthy && info.region.to_lowercase().contains(&region.to_lowercase()))
            .collect();
        
        if let Some((_, (control, _))) = matching.choose(&mut rand::thread_rng()) {
            Some(control.clone())
        } else {
            None
        }
    }

    /// Get node with least connections (load balancing)
    pub fn get_least_loaded(&self) -> Option<Control> {
        self.nodes.iter()
            .filter(|(_, (_, info))| info.is_healthy && info.active_connections < info.max_connections)
            .min_by_key(|(_, (_, info))| info.active_connections)
            .map(|(_, (control, _))| control.clone())
    }

    /// List all nodes with their info
    pub fn list_nodes(&self) -> Vec<NodeInfo> {
        self.nodes.values().map(|(_, info)| info.clone()).collect()
    }
}

/// Selection strategy for routing requests
#[derive(Clone, Debug)]
pub enum SelectionStrategy {
    Random,
    Best,
    LeastLoaded,
    ByCountry(String),
    ByRegion(String),
}

pub struct AppState {
    pub registry: Arc<Mutex<NodeRegistry>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            registry: Arc::new(Mutex::new(NodeRegistry::new())),
        }
    }

    /// Select a provider based on strategy
    pub fn select_provider(&self, strategy: SelectionStrategy) -> Option<Control> {
        let registry = self.registry.lock().unwrap();
        
        match strategy {
            SelectionStrategy::Random => registry.get_random(),
            SelectionStrategy::Best => registry.get_best().map(|(c, _)| c),
            SelectionStrategy::LeastLoaded => registry.get_least_loaded(),
            SelectionStrategy::ByCountry(code) => {
                registry.get_by_country(&code).or_else(|| registry.get_random())
            }
            SelectionStrategy::ByRegion(region) => {
                registry.get_by_region(&region).or_else(|| registry.get_random())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_node(id: &str, latency: u32, active: u32, max: u32, healthy: bool) -> NodeInfo {
        NodeInfo {
            node_id: id.to_string(),
            country_code: "GH".to_string(),
            region: "Accra".to_string(),
            ip_address: "192.168.1.1".to_string(),
            connected_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            total_bytes_served: 0,
            active_connections: active,
            max_connections: max,
            latency_ms: latency,
            is_healthy: healthy,
        }
    }

    #[test]
    fn test_node_score_healthy() {
        let node = create_test_node("node-1", 50, 0, 100, true);
        let score = node.score();
        assert!(score > 900);
    }

    #[test]
    fn test_node_score_unhealthy() {
        let node = create_test_node("node-2", 50, 0, 100, false);
        let score = node.score();
        assert_eq!(score, 0);
    }

    #[test]
    fn test_node_score_high_latency() {
        let low_latency = create_test_node("node-low", 20, 0, 100, true);
        let high_latency = create_test_node("node-high", 200, 0, 100, true);
        assert!(low_latency.score() > high_latency.score());
    }

    #[test]
    fn test_node_score_high_load() {
        let low_load = create_test_node("node-low", 50, 10, 100, true);
        let high_load = create_test_node("node-high", 50, 80, 100, true);
        assert!(low_load.score() > high_load.score());
    }

    #[test]
    fn test_node_info_creation() {
        let node = NodeInfo::new("test-node".to_string(), "10.0.0.1".to_string());
        assert_eq!(node.node_id, "test-node");
        assert_eq!(node.ip_address, "10.0.0.1");
        assert!(node.is_healthy);
    }
}
