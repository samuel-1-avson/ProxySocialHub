use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{error, info, warn};

/// Circuit breaker state
#[derive(Debug, Clone, PartialEq)]
pub enum CircuitState {
    /// Circuit is closed, requests pass through normally
    Closed { failures: u32 },
    /// Circuit is open, requests fail fast
    Open { last_failure: Instant },
    /// Circuit is half-open, testing if service recovered
    HalfOpen { successes: u32 },
}

impl CircuitState {
    pub fn as_str(&self) -> &'static str {
        match self {
            CircuitState::Closed { .. } => "closed",
            CircuitState::Open { .. } => "open",
            CircuitState::HalfOpen { .. } => "half-open",
        }
    }
}

/// Circuit breaker configuration
#[derive(Debug, Clone)]
pub struct CircuitConfig {
    /// Number of failures before opening the circuit
    pub failure_threshold: u32,
    /// Time to wait before transitioning from Open to HalfOpen
    pub timeout: Duration,
    /// Number of consecutive successes needed to close from HalfOpen
    pub success_threshold: u32,
    /// Timeout for individual requests
    pub request_timeout: Duration,
}

impl Default for CircuitConfig {
    fn default() -> Self {
        Self::from_env(10)
    }
}

impl CircuitConfig {
    /// Unified provider circuit breaker settings (P2 — env `CB_*`).
    pub fn from_env(default_request_timeout_secs: u64) -> Self {
        fn env_u32(key: &str, default: u32) -> u32 {
            std::env::var(key)
                .ok()
                .and_then(|v| v.parse().ok())
                .filter(|&n| n > 0)
                .unwrap_or(default)
        }
        fn env_secs(key: &str, default: u64) -> u64 {
            std::env::var(key)
                .ok()
                .and_then(|v| v.parse().ok())
                .filter(|&n| n > 0)
                .unwrap_or(default)
        }

        let request_secs = env_secs("CB_REQUEST_TIMEOUT_SECS", default_request_timeout_secs);
        Self {
            failure_threshold: env_u32("CB_FAILURE_THRESHOLD", 3),
            timeout: Duration::from_secs(env_secs("CB_OPEN_TIMEOUT_SECS", 30)),
            success_threshold: env_u32("CB_SUCCESS_THRESHOLD", 2),
            request_timeout: Duration::from_secs(request_secs),
        }
    }
}

/// Circuit breaker errors
#[derive(Debug, thiserror::Error)]
pub enum CircuitError<E> {
    #[error("Circuit breaker is open")]
    Open,
    #[error("Request timeout")]
    Timeout,
    #[error("Service failure: {0}")]
    Failure(E),
}

/// Async circuit breaker implementation
pub struct CircuitBreaker {
    state: Arc<RwLock<CircuitState>>,
    config: CircuitConfig,
    service_name: String,
}

impl CircuitBreaker {
    /// Create a new circuit breaker
    pub fn new(service_name: String, config: CircuitConfig) -> Self {
        Self {
            state: Arc::new(RwLock::new(CircuitState::Closed { failures: 0 })),
            config,
            service_name,
        }
    }

    /// Execute a function with circuit breaker protection
    pub async fn call<F, T, E, Fut>(&self, f: F) -> Result<T, CircuitError<E>>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T, E>>,
        E: std::fmt::Debug,
    {
        // Check if we can make the request
        if !self.can_request().await {
            return Err(CircuitError::Open);
        }

        // Execute with timeout
        let result = tokio::time::timeout(self.config.request_timeout, f()).await;

        match result {
            Ok(Ok(value)) => {
                self.on_success().await;
                Ok(value)
            }
            Ok(Err(e)) => {
                self.on_failure().await;
                Err(CircuitError::Failure(e))
            }
            Err(_) => {
                self.on_failure().await;
                Err(CircuitError::Timeout)
            }
        }
    }

    /// Check if a request can be made based on current state
    async fn can_request(&self) -> bool {
        let mut state = self.state.write().await;

        match *state {
            CircuitState::Closed { .. } => true,
            CircuitState::Open { last_failure } => {
                if last_failure.elapsed() > self.config.timeout {
                    info!(
                        "Circuit breaker {} transitioning to half-open",
                        self.service_name
                    );
                    *state = CircuitState::HalfOpen { successes: 0 };
                    true
                } else {
                    false
                }
            }
            CircuitState::HalfOpen { .. } => true,
        }
    }

    /// Handle successful request
    async fn on_success(&self) {
        let mut state = self.state.write().await;

        match *state {
            CircuitState::Closed { .. } => {
                // Reset failure count on success
                *state = CircuitState::Closed { failures: 0 };
            }
            CircuitState::HalfOpen { successes } => {
                let new_successes = successes + 1;
                if new_successes >= self.config.success_threshold {
                    info!(
                        "Circuit breaker {} closed after {} consecutive successes",
                        self.service_name, new_successes
                    );
                    *state = CircuitState::Closed { failures: 0 };
                } else {
                    info!(
                        "Circuit breaker {} half-open success {}/{}",
                        self.service_name, new_successes, self.config.success_threshold
                    );
                    *state = CircuitState::HalfOpen {
                        successes: new_successes,
                    };
                }
            }
            CircuitState::Open { .. } => {
                // This shouldn't happen, but handle gracefully
                warn!(
                    "Unexpected success in open circuit breaker {}",
                    self.service_name
                );
            }
        }
    }

    /// Handle failed request
    async fn on_failure(&self) {
        let mut state = self.state.write().await;

        match *state {
            CircuitState::Closed { failures } => {
                let new_failures = failures + 1;
                if new_failures >= self.config.failure_threshold {
                    warn!(
                        "Circuit breaker {} opening after {} failures",
                        self.service_name, new_failures
                    );
                    *state = CircuitState::Open {
                        last_failure: Instant::now(),
                    };
                } else {
                    *state = CircuitState::Closed {
                        failures: new_failures,
                    };
                }
            }
            CircuitState::HalfOpen { .. } => {
                warn!(
                    "Circuit breaker {} reopening after failure in half-open state",
                    self.service_name
                );
                *state = CircuitState::Open {
                    last_failure: Instant::now(),
                };
            }
            CircuitState::Open { .. } => {
                // Update last failure time
                *state = CircuitState::Open {
                    last_failure: Instant::now(),
                };
            }
        }
    }

    /// Get current circuit breaker state
    pub async fn state(&self) -> CircuitState {
        self.state.read().await.clone()
    }

    /// Get circuit breaker statistics
    pub async fn stats(&self) -> CircuitStats {
        let state = self.state.read().await;

        match *state {
            CircuitState::Closed { failures } => CircuitStats {
                service_name: self.service_name.clone(),
                state: "closed".to_string(),
                failures,
                last_failure_secs: None,
            },
            CircuitState::Open { last_failure } => CircuitStats {
                service_name: self.service_name.clone(),
                state: "open".to_string(),
                failures: 0,
                last_failure_secs: Some(last_failure.elapsed().as_secs()),
            },
            CircuitState::HalfOpen { .. } => CircuitStats {
                service_name: self.service_name.clone(),
                state: "half-open".to_string(),
                failures: 0,
                last_failure_secs: None,
            },
        }
    }
}

/// Circuit breaker statistics
#[derive(Debug, Clone, serde::Serialize)]
pub struct CircuitStats {
    pub service_name: String,
    pub state: String,
    pub failures: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_failure_secs: Option<u64>,
}

/// Circuit breaker manager for multiple services
pub struct CircuitBreakerManager {
    breakers: Arc<RwLock<std::collections::HashMap<String, Arc<CircuitBreaker>>>>,
}

impl CircuitBreakerManager {
    pub fn new() -> Self {
        Self {
            breakers: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    /// Get or create a circuit breaker for a service
    pub async fn get_breaker(
        &self,
        service_name: &str,
        config: CircuitConfig,
    ) -> Arc<CircuitBreaker> {
        let breakers = self.breakers.read().await;
        if let Some(breaker) = breakers.get(service_name) {
            return breaker.clone();
        }
        drop(breakers);

        // Create new breaker
        let mut breakers = self.breakers.write().await;
        // Double-check after acquiring write lock
        if let Some(breaker) = breakers.get(service_name) {
            return breaker.clone();
        }

        let breaker = Arc::new(CircuitBreaker::new(service_name.to_string(), config));
        breakers.insert(service_name.to_string(), breaker.clone());
        breaker
    }

    /// Get statistics for all circuit breakers
    pub async fn get_all_stats(&self) -> Vec<CircuitStats> {
        let breakers = self.breakers.read().await;
        let mut stats = Vec::new();

        for breaker in breakers.values() {
            stats.push(breaker.stats().await);
        }

        stats
    }
}

impl Default for CircuitBreakerManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::{sleep, Duration};

    #[tokio::test]
    async fn test_circuit_breaker_closed_state() {
        let config = CircuitConfig {
            failure_threshold: 3,
            timeout: Duration::from_millis(100),
            success_threshold: 2,
            request_timeout: Duration::from_millis(50),
        };

        let cb = CircuitBreaker::new("test".to_string(), config);

        // Should start in closed state
        let state = cb.state().await;
        assert!(matches!(state, CircuitState::Closed { failures: 0 }));

        // Successful calls should keep it closed
        for _ in 0..5 {
            let result = cb.call(|| async { Ok::<_, &str>("success") }).await;
            assert!(result.is_ok());
            let state = cb.state().await;
            assert!(matches!(state, CircuitState::Closed { failures: 0 }));
        }
    }

    #[tokio::test]
    async fn test_circuit_breaker_opens() {
        let config = CircuitConfig {
            failure_threshold: 3,
            timeout: Duration::from_millis(100),
            success_threshold: 2,
            request_timeout: Duration::from_millis(50),
        };

        let cb = CircuitBreaker::new("test".to_string(), config);

        // Make failures to open the circuit
        for i in 0..3 {
            let result = cb.call(|| async { Err::<&str, _>("error") }).await;
            assert!(matches!(result, Err(CircuitError::Failure(_))));

            let state = cb.state().await;
            if i < 2 {
                assert!(matches!(state, CircuitState::Closed { failures: _ }));
            } else {
                assert!(matches!(state, CircuitState::Open { .. }));
            }
        }

        // Next call should fail immediately
        let result = cb
            .call(|| async { Ok::<_, &str>("should not be called") })
            .await;
        assert!(matches!(result, Err(CircuitError::Open)));
    }

    #[tokio::test]
    async fn test_circuit_breaker_half_open() {
        let config = CircuitConfig {
            failure_threshold: 2,
            timeout: Duration::from_millis(50),
            success_threshold: 1,
            request_timeout: Duration::from_millis(100),
        };

        let cb = CircuitBreaker::new("test".to_string(), config);

        // Open the circuit
        for _ in 0..2 {
            let _ = cb.call(|| async { Err::<&str, _>("error") }).await;
        }

        let state = cb.state().await;
        assert!(matches!(state, CircuitState::Open { .. }));

        // Wait for timeout
        sleep(Duration::from_millis(60)).await;

        // Next call should transition to half-open and succeed
        let result = cb.call(|| async { Ok::<_, &str>("success") }).await;
        assert!(result.is_ok());

        let state = cb.state().await;
        assert!(matches!(state, CircuitState::Closed { failures: 0 }));
    }

    #[test]
    fn circuit_config_from_env_uses_defaults() {
        let prev = std::env::var("CB_FAILURE_THRESHOLD").ok();
        std::env::remove_var("CB_FAILURE_THRESHOLD");
        let cfg = CircuitConfig::from_env(15);
        assert_eq!(cfg.failure_threshold, 3);
        assert_eq!(cfg.request_timeout, Duration::from_secs(15));
        if let Some(v) = prev {
            std::env::set_var("CB_FAILURE_THRESHOLD", v);
        }
    }

    #[tokio::test]
    async fn test_circuit_breaker_timeout() {
        let config = CircuitConfig {
            failure_threshold: 3,
            timeout: Duration::from_millis(100),
            success_threshold: 2,
            request_timeout: Duration::from_millis(50),
        };

        let cb = CircuitBreaker::new("test".to_string(), config);

        // Call that takes longer than timeout
        let result = cb
            .call(|| async {
                sleep(Duration::from_millis(100)).await;
                Ok::<_, &str>("success")
            })
            .await;

        assert!(matches!(result, Err(CircuitError::Timeout)));
    }
}
