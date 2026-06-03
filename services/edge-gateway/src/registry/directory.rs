//! Shared provider ownership directory (P3a).
//!
//! Maps `node_id` → owning edge pod id in Redis so multiple gateway replicas can
//! discover which pod holds the live yamux `Control` handle.

use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use std::error::Error;
use std::time::{SystemTime, UNIX_EPOCH};

const KEY_PREFIX: &str = "eg:provider:owner:";

/// Release only if the stored JSON record's pod_id matches this pod.
const RELEASE_LUA: &str = r#"
local val = redis.call("GET", KEYS[1])
if not val then return 0 end
local needle1 = '"pod_id":"' .. ARGV[1] .. '"'
local needle2 = '"pod_id": "' .. ARGV[1] .. '"'
if string.find(val, needle1, 1, true) or string.find(val, needle2, 1, true) then
  return redis.call("DEL", KEYS[1])
end
return 0
"#;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct ProviderOwnership {
    pub node_id: String,
    pub pod_id: String,
    pub region: Option<String>,
    pub updated_at: u64,
    /// Routing metadata (P3.1) — copied from `NodeInfo` at claim time.
    #[serde(default)]
    pub country_code: String,
    #[serde(default)]
    pub latency_ms: u32,
    #[serde(default = "default_healthy")]
    pub is_healthy: bool,
    #[serde(default)]
    pub quality_score: f64,
}

fn default_healthy() -> bool {
    true
}

pub struct ProviderDirectory {
    conn: ConnectionManager,
    pod_id: String,
    region: Option<String>,
    ttl_secs: u64,
}

impl ProviderDirectory {
    pub async fn new(
        redis_url: &str,
        pod_id: String,
        region: Option<String>,
        ttl_secs: u64,
    ) -> Result<Self, Box<dyn Error + Send + Sync>> {
        let client = redis::Client::open(redis_url)?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self {
            conn,
            pod_id,
            region,
            ttl_secs: ttl_secs.max(30),
        })
    }

    pub fn from_manager(
        conn: ConnectionManager,
        pod_id: String,
        region: Option<String>,
        ttl_secs: u64,
    ) -> Self {
        Self {
            conn,
            pod_id,
            region,
            ttl_secs: ttl_secs.max(30),
        }
    }

    pub fn pod_id(&self) -> &str {
        &self.pod_id
    }

    fn key(node_id: &str) -> String {
        format!("{KEY_PREFIX}{node_id}")
    }

    fn now_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    /// Claim ownership for a provider connected on this pod (metadata only).
    pub async fn claim(&self, node_id: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
        let record = ProviderOwnership {
            node_id: node_id.to_string(),
            pod_id: self.pod_id.clone(),
            region: self.region.clone(),
            updated_at: Self::now_secs(),
            country_code: String::new(),
            latency_ms: 0,
            is_healthy: true,
            quality_score: 0.0,
        };
        self.write_record(&record).await
    }

    /// Claim with full routing metadata from the live registry entry.
    pub async fn claim_with_info(
        &self,
        info: &crate::state::NodeInfo,
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        let record = ProviderOwnership {
            node_id: info.node_id.clone(),
            pod_id: self.pod_id.clone(),
            region: if info.region.is_empty() {
                self.region.clone()
            } else {
                Some(info.region.clone())
            },
            updated_at: Self::now_secs(),
            country_code: info.country_code.clone(),
            latency_ms: info.latency_ms,
            is_healthy: info.is_healthy,
            quality_score: info.quality_score,
        };
        self.write_record(&record).await
    }

    async fn write_record(
        &self,
        record: &ProviderOwnership,
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        let json = serde_json::to_string(record)?;
        let mut conn = self.conn.clone();
        let key = Self::key(&record.node_id);
        let _: () = conn.set_ex(&key, json, self.ttl_secs).await?;
        tracing::info!(
            node_id = %record.node_id,
            pod_id = %record.pod_id,
            %key,
            ttl_secs = self.ttl_secs,
            "Provider directory ownership claimed"
        );
        Ok(())
    }

    /// Refresh TTL for an active provider (heartbeats).
    pub async fn touch(&self, node_id: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
        self.claim(node_id).await
    }

    /// Drop ownership when this pod's tunnel closes.
    pub async fn release(&self, node_id: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
        let mut conn = self.conn.clone();
        let key = Self::key(node_id);
        let _: i32 = redis::Script::new(RELEASE_LUA)
            .key(&key)
            .arg(&self.pod_id)
            .invoke_async(&mut conn)
            .await?;
        Ok(())
    }

    pub async fn lookup(
        &self,
        node_id: &str,
    ) -> Result<Option<ProviderOwnership>, Box<dyn Error + Send + Sync>> {
        let mut conn = self.conn.clone();
        let key = Self::key(node_id);
        let raw: Option<String> = conn.get(&key).await?;
        match raw {
            Some(json) => Ok(Some(serde_json::from_str(&json)?)),
            None => Ok(None),
        }
    }

    pub fn is_local_owner(&self, owner_pod_id: &str) -> bool {
        owner_pod_id == self.pod_id
    }

    /// List all provider ownership records visible in Redis (P3.1 fleet selection).
    pub async fn list_all(&self) -> Result<Vec<ProviderOwnership>, Box<dyn Error + Send + Sync>> {
        let mut conn = self.conn.clone();
        let pattern = format!("{KEY_PREFIX}*");
        let mut cursor: u64 = 0;
        let mut out = Vec::new();

        loop {
            let (next, keys): (u64, Vec<String>) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg(&pattern)
                .arg("COUNT")
                .arg(128)
                .query_async(&mut conn)
                .await?;

            for key in keys {
                let raw: Option<String> = conn.get(&key).await?;
                if let Some(json) = raw {
                    if let Ok(record) = serde_json::from_str::<ProviderOwnership>(&json) {
                        out.push(record);
                    }
                }
            }

            cursor = next;
            if cursor == 0 {
                break;
            }
        }

        Ok(out)
    }

    /// Keys in Redis owned by this pod (`pod_id` in JSON record).
    pub async fn count_owned(&self) -> Result<usize, Box<dyn Error + Send + Sync>> {
        let records = self.list_all().await?;
        Ok(records.iter().filter(|r| r.pod_id == self.pod_id).count())
    }

    /// Release every directory entry owned by this pod (drain / shutdown).
    pub async fn release_all_owned(&self) -> Result<usize, Box<dyn Error + Send + Sync>> {
        let records = self.list_all().await?;
        let owned: Vec<String> = records
            .into_iter()
            .filter(|r| r.pod_id == self.pod_id)
            .map(|r| r.node_id)
            .collect();
        let mut released = 0usize;
        for node_id in owned {
            self.release(&node_id).await?;
            released += 1;
        }
        if released > 0 {
            tracing::info!(
                pod_id = %self.pod_id,
                released,
                "Released provider directory ownership for pod drain"
            );
        }
        Ok(released)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ownership_key_format() {
        assert_eq!(
            ProviderDirectory::key("node-abc"),
            "eg:provider:owner:node-abc"
        );
    }
}
