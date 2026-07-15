use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RuntimeState {
    #[serde(default)]
    pub provider_run_id: String,
    pub active_gateway: String,
    pub gateway_index: usize,
    pub gateway_total: usize,
    pub transport: String,
    pub tunnel_connected: bool,
    pub last_session_error: Option<String>,
    pub updated_at_unix: u64,
}

pub fn new_provider_run_id() -> String {
    format!("run_{}", uuid::Uuid::new_v4())
}

pub fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl RuntimeState {
    pub fn write(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let body = serde_json::to_string_pretty(self)?;
        std::fs::write(path, body)
    }

    pub fn read(path: &Path) -> Option<Self> {
        let body = std::fs::read_to_string(path).ok()?;
        serde_json::from_str(&body).ok()
    }

    /// Merge tunnel connectivity into the on-disk runtime snapshot (for TUI / watch).
    pub fn set_tunnel_connected(connected: bool, clear_error_on_connect: bool) {
        let path = crate::paths::runtime_state_file();
        let mut rt = Self::read(&path).unwrap_or_default();
        rt.tunnel_connected = connected;
        if connected && clear_error_on_connect {
            rt.last_session_error = None;
        }
        rt.updated_at_unix = unix_now();
        let _ = rt.write(&path);
    }
}
