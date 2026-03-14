use redis::AsyncCommands;
use redis::aio::ConnectionManager;
use serde_json;
use crate::state::NodeInfo;
use std::error::Error;

pub struct RegistryStore {
    // P-07: Persistent multiplexed connection — reused across all node operations.
    conn: ConnectionManager,
    // Kept for components (HeartbeatStore, LeaderElector) that need their own redis::Client.
    raw_client: redis::Client,
}

impl RegistryStore {
    pub fn new(redis_url: &str) -> Result<Self, Box<dyn Error + Send + Sync>> {
        let client = redis::Client::open(redis_url)?;
        let conn = tokio::runtime::Handle::current()
            .block_on(ConnectionManager::new(client.clone()))?;
        Ok(Self { conn, raw_client: client })
    }

    /// Return a redis::Client for components that manage their own connections.
    pub fn client(&self) -> redis::Client {
        self.raw_client.clone()
    }

    /// Load node info for a user ID
    pub async fn load_node(&self, user_id: &str) -> Result<Option<NodeInfo>, Box<dyn Error + Send + Sync>> {
        let mut conn = self.conn.clone();
        let key = format!("node:{}:info", user_id);
        
        let existing: Option<String> = conn.get(&key).await?;
        
        match existing {
            Some(json) => {
                let node_info: NodeInfo = serde_json::from_str(&json)?;
                Ok(Some(node_info))
            },
            None => Ok(None),
        }
    }

    /// Save or update node info
    pub async fn save_node(&self, user_id: &str, info: &NodeInfo) -> Result<(), Box<dyn Error + Send + Sync>> {
        let mut conn = self.conn.clone();
        let key = format!("node:{}:info", user_id);
        
        let json = serde_json::to_string(info)?;
        
        // Save persistently (or with long TTL, e.g. 7 days of inactivity)
        let _: () = conn.set(&key, json).await?;
        // Reset TTL to 7 days
        let _: () = conn.expire(&key, 60 * 60 * 24 * 7).await?;
        
        Ok(())
    }
}
