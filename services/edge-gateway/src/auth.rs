use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::sync::Arc;
use tokio::sync::RwLock;
use std::collections::HashMap;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionData {
    pub user_id: String,
    pub session_id: String,
    #[serde(default)]
    pub provider_id: String,
    #[serde(rename = "type")]
    pub session_type: String,
    pub status: String,
    pub bandwidth_limit: i64,
    pub bandwidth_used: i64,
    #[serde(default)]
    pub trust_tier: String,
    #[serde(default)]
    pub target_geo: String,
    #[serde(default)]
    pub target_isp: String,
}

struct CachedSession {
    data: SessionData,
    cached_at: Instant,
}

pub struct SessionAuthenticator {
    client: redis::Client,
    // LRU cache for validated sessions (5 min TTL)
    cache: Arc<RwLock<HashMap<String, CachedSession>>>,
    cache_ttl: Duration,
}

impl SessionAuthenticator {
    pub fn new(redis_url: &str) -> Result<Self, Box<dyn Error + Send + Sync>> {
        let client = redis::Client::open(redis_url)?;
        Ok(Self { 
            client,
            cache: Arc::new(RwLock::new(HashMap::new())),
            cache_ttl: Duration::from_secs(300), // 5 minutes
        })
    }

    /// Validate session and return session data if valid
    pub async fn validate_session(&self, username: &str) -> Result<Option<SessionData>, Box<dyn Error + Send + Sync>> {
        // Check cache first
        {
            let cache = self.cache.read().await;
            if let Some(cached) = cache.get(username) {
                if cached.cached_at.elapsed() < self.cache_ttl {
                    return Ok(Some(cached.data.clone()));
                }
            }
        }

        // Fetch from Redis
        let mut con = self.client.get_multiplexed_async_connection().await?;
        let key = format!("session:{}", username);
        let data: Option<String> = con.get(&key).await?;

        match data {
            Some(json_str) => {
                let session_data: SessionData = serde_json::from_str(&json_str)?;
                
                // Check if session is active
                if session_data.status != "active" {
                    return Ok(None);
                }

                // Check bandwidth limit
                if session_data.bandwidth_used >= session_data.bandwidth_limit {
                    return Ok(None);
                }

                // Cache the session
                {
                    let mut cache = self.cache.write().await;
                    cache.insert(username.to_string(), CachedSession {
                        data: session_data.clone(),
                        cached_at: Instant::now(),
                    });
                }

                Ok(Some(session_data))
            }
            None => Ok(None),
        }
    }

    /// Report usage for a session
    pub async fn report_usage(&self, username: &str, bytes: i64) -> Result<(), Box<dyn Error + Send + Sync>> {
        let mut con = self.client.get_multiplexed_async_connection().await?;
        let key = format!("session:{}:usage", username);
        let _: () = con.incr(&key, bytes).await?;
        Ok(())
    }

    /// Invalidate cached session
    pub async fn invalidate_cache(&self, username: &str) {
        let mut cache = self.cache.write().await;
        cache.remove(username);
    }

    // ========== Sticky Session Methods ==========

    /// Get the sticky node binding for a session
    /// Returns Some(node_id) if session is bound, None otherwise
    pub async fn get_sticky_node(&self, session_id: &str) -> Result<Option<String>, Box<dyn Error + Send + Sync>> {
        let mut con = self.client.get_multiplexed_async_connection().await?;
        let key = format!("sticky:{}", session_id);
        let node_id: Option<String> = con.get(&key).await?;
        Ok(node_id)
    }

    /// Bind a session to a specific node (for sticky sessions)
    pub async fn set_sticky_node(&self, session_id: &str, node_id: &str, ttl_secs: u64) -> Result<(), Box<dyn Error + Send + Sync>> {
        let mut con = self.client.get_multiplexed_async_connection().await?;
        let key = format!("sticky:{}", session_id);
        let _: () = con.set_ex(&key, node_id, ttl_secs).await?;
        Ok(())
    }

    /// Remove sticky binding (e.g., when session terminates)
    pub async fn remove_sticky_node(&self, session_id: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
        let mut con = self.client.get_multiplexed_async_connection().await?;
        let key = format!("sticky:{}", session_id);
        let _: () = con.del(&key).await?;
        Ok(())
    }

    // ========== Rate Limiting Methods ==========

    /// Check and increment rate limit counter
    /// Returns Ok(true) if allowed, Ok(false) if rate limited
    pub async fn check_rate_limit(&self, session_id: &str, limit_per_minute: u32) -> Result<bool, Box<dyn Error + Send + Sync>> {
        let mut con = self.client.get_multiplexed_async_connection().await?;
        let key = format!("ratelimit:{}", session_id);
        
        // INCR the counter
        let count: i64 = con.incr(&key, 1).await?;
        
        // Set expiry on first request (60 seconds window)
        if count == 1 {
            let _: () = con.expire(&key, 60).await?;
        }
        
        Ok(count <= limit_per_minute as i64)
    }

    /// Get current request count for a session
    pub async fn get_request_count(&self, session_id: &str) -> Result<u32, Box<dyn Error + Send + Sync>> {
        let mut con = self.client.get_multiplexed_async_connection().await?;
        let key = format!("ratelimit:{}", session_id);
        let count: Option<u32> = con.get(&key).await?;
        Ok(count.unwrap_or(0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_data_deserialization() {
        let json = r#"{
            "user_id": "user-123",
            "session_id": "sess-456",
            "type": "rotating",
            "status": "active",
            "bandwidth_limit": 5368709120,
            "bandwidth_used": 1073741824
        }"#;

        let session: SessionData = serde_json::from_str(json).expect("Failed to parse");
        
        assert_eq!(session.user_id, "user-123");
        assert_eq!(session.session_id, "sess-456");
        assert_eq!(session.session_type, "rotating");
        assert_eq!(session.status, "active");
        assert_eq!(session.bandwidth_limit, 5368709120); // 5GB
        assert_eq!(session.bandwidth_used, 1073741824);  // 1GB
    }

    #[test]
    fn test_session_data_serialization() {
        let session = SessionData {
            user_id: "user-789".to_string(),
            session_id: "sess-abc".to_string(),
            session_type: "sticky".to_string(),
            status: "active".to_string(),
            bandwidth_limit: 10737418240,
            bandwidth_used: 0,
        };

        let json = serde_json::to_string(&session).expect("Failed to serialize");
        assert!(json.contains("user-789"));
        assert!(json.contains("sticky"));
    }

    #[test]
    fn test_session_status_check() {
        let active_session = SessionData {
            user_id: "u1".to_string(),
            session_id: "s1".to_string(),
            session_type: "rotating".to_string(),
            status: "active".to_string(),
            bandwidth_limit: 1000,
            bandwidth_used: 500,
        };
        
        assert_eq!(active_session.status, "active");
        assert!(active_session.bandwidth_used < active_session.bandwidth_limit);

        let terminated_session = SessionData {
            status: "terminated".to_string(),
            ..active_session.clone()
        };
        
        assert_ne!(terminated_session.status, "active");
    }

    #[test]
    fn test_bandwidth_limit_exceeded() {
        let session = SessionData {
            user_id: "u1".to_string(),
            session_id: "s1".to_string(),
            session_type: "rotating".to_string(),
            status: "active".to_string(),
            bandwidth_limit: 1000,
            bandwidth_used: 1500, // Exceeded
        };

        assert!(session.bandwidth_used >= session.bandwidth_limit);
    }
}

