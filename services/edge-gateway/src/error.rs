//! Error types for Edge Gateway
//! 
//! Centralized error handling for all gateway operations.

use std::fmt;

/// Main error type for the edge gateway
#[derive(Debug)]
pub enum Error {
    /// Internal server error
    Internal(String),
    
    /// Configuration error
    Configuration(String),
    
    /// Validation error
    Validation(String),
    
    /// Authentication error
    Authentication(String),
    
    /// Authorization error
    Authorization(String),
    
    /// Not found
    NotFound(String),
    
    /// Rate limit exceeded
    RateLimited { retry_after: Option<u64> },
    
    /// Circuit breaker open
    CircuitOpen(String),
    
    /// Blockchain connection error
    BlockchainConnection(String),
    
    /// Redis connection error
    RedisConnection(String),
    
    /// Serialization error
    Serialization(String),
    
    /// Network error
    Network(String),
    
    /// Timeout
    Timeout(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Internal(msg) => write!(f, "Internal error: {}", msg),
            Error::Configuration(msg) => write!(f, "Configuration error: {}", msg),
            Error::Validation(msg) => write!(f, "Validation error: {}", msg),
            Error::Authentication(msg) => write!(f, "Authentication error: {}", msg),
            Error::Authorization(msg) => write!(f, "Authorization error: {}", msg),
            Error::NotFound(msg) => write!(f, "Not found: {}", msg),
            Error::RateLimited { retry_after } => {
                if let Some(after) = retry_after {
                    write!(f, "Rate limited, retry after {} seconds", after)
                } else {
                    write!(f, "Rate limited")
                }
            }
            Error::CircuitOpen(msg) => write!(f, "Circuit breaker open: {}", msg),
            Error::BlockchainConnection(msg) => write!(f, "Blockchain connection error: {}", msg),
            Error::RedisConnection(msg) => write!(f, "Redis connection error: {}", msg),
            Error::Serialization(msg) => write!(f, "Serialization error: {}", msg),
            Error::Network(msg) => write!(f, "Network error: {}", msg),
            Error::Timeout(msg) => write!(f, "Timeout: {}", msg),
        }
    }
}

impl std::error::Error for Error {}

/// Result type alias using our Error type
pub type Result<T> = std::result::Result<T, Error>;

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Serialization(e.to_string())
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Network(e.to_string())
    }
}

impl From<hex::FromHexError> for Error {
    fn from(e: hex::FromHexError) -> Self {
        Error::Validation(format!("Hex decode error: {}", e))
    }
}

impl From<ed25519_dalek::SignatureError> for Error {
    fn from(e: ed25519_dalek::SignatureError) -> Self {
        Error::Validation(format!("Signature error: {}", e))
    }
}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        Error::Network(format!("HTTP error: {}", e))
    }
}

impl From<tonic::transport::Error> for Error {
    fn from(e: tonic::transport::Error) -> Self {
        Error::BlockchainConnection(format!("gRPC transport error: {}", e))
    }
}
