//! P1-A4: Redis Connection Pool
//!
//! Provides a connection pool for Redis to reduce connection overhead
//! and improve performance under load.

use deadpool_redis::{Config, Pool, Runtime};
use redis::AsyncCommands;
use std::sync::Arc;

/// Redis connection pool wrapper
pub struct RedisPool {
    pool: Pool,
}

impl RedisPool {
    /// Create a new Redis connection pool
    ///
    /// # Arguments
    /// * `redis_url` - Redis connection URL
    /// * `max_size` - Maximum number of connections in the pool
    ///
    /// # Example
    /// ```
    /// let pool = RedisPool::new("redis://localhost:6379", 32).await?;
    /// ```
    pub async fn new(
        redis_url: &str,
        max_size: usize,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let cfg = Config::from_url(redis_url);
        let pool = cfg
            .builder()?
            .max_size(max_size)
            .runtime(Runtime::Tokio1)
            .build()?;

        // Test the pool with a ping
        let mut conn = pool.get().await?;
        let pong: String = redis::cmd("PING").query_async(&mut conn).await?;
        if pong != "PONG" {
            return Err("Redis ping failed".into());
        }

        tracing::info!("Redis pool initialized: max_size={}", max_size);

        Ok(Self { pool })
    }

    /// Get a connection from the pool
    ///
    /// Returns a pooled connection that will be returned to the pool when dropped.
    pub async fn get(&self) -> Result<deadpool_redis::Connection, deadpool_redis::PoolError> {
        self.pool.get().await
    }

    /// Get pool status
    pub fn status(&self) -> deadpool_redis::Status {
        self.pool.status()
    }

    /// Get the underlying pool (for advanced use cases)
    pub fn inner(&self) -> &Pool {
        &self.pool
    }
}

impl Clone for RedisPool {
    fn clone(&self) -> Self {
        Self {
            pool: self.pool.clone(),
        }
    }
}

/// P1-A4: Pooled connection manager for SessionAuthenticator
///
/// This replaces the single ConnectionManager with a pool for better concurrency.
pub struct PooledConnectionManager {
    pool: RedisPool,
}

impl PooledConnectionManager {
    pub async fn new(
        redis_url: &str,
        pool_size: usize,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let pool = RedisPool::new(redis_url, pool_size).await?;
        Ok(Self { pool })
    }

    /// Get a connection from the pool
    pub async fn get(&self) -> Result<deadpool_redis::Connection, deadpool_redis::PoolError> {
        self.pool.get().await
    }

    /// Get pool status
    pub fn status(&self) -> deadpool_redis::Status {
        self.pool.status()
    }
}

impl Clone for PooledConnectionManager {
    fn clone(&self) -> Self {
        Self {
            pool: self.pool.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_redis_pool_creation() {
        // This test requires a running Redis instance
        // Skip if Redis is not available
        let pool = match RedisPool::new("redis://localhost:6379", 4).await {
            Ok(p) => p,
            Err(_) => {
                println!("Skipping test - Redis not available");
                return;
            }
        };

        // Get a connection
        let mut conn = pool.get().await.expect("Failed to get connection");

        // Test basic operation
        let _: () = redis::cmd("SET")
            .arg("test:key")
            .arg("test_value")
            .query_async(&mut conn)
            .await
            .expect("Failed to set key");

        let value: String = redis::cmd("GET")
            .arg("test:key")
            .query_async(&mut conn)
            .await
            .expect("Failed to get key");

        assert_eq!(value, "test_value");

        // Cleanup
        let _: () = redis::cmd("DEL")
            .arg("test:key")
            .query_async(&mut conn)
            .await
            .expect("Failed to delete key");
    }

    #[tokio::test]
    async fn test_pool_status() {
        let pool = match RedisPool::new("redis://localhost:6379", 4).await {
            Ok(p) => p,
            Err(_) => {
                println!("Skipping test - Redis not available");
                return;
            }
        };

        let status = pool.status();
        // Verify pool is working - max_size should be 4
        assert!(status.max_size >= 4);
        // Note: available and waiting depend on current pool state
    }
}
