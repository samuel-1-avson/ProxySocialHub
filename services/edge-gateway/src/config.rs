use std::env;
use std::net::SocketAddr;

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub tunnel_port: u16,
    pub redis_url: String,
    pub sticky_ttl_secs: u64,
    pub jwt_secret: String,
    pub provider_private_key: String,
    pub geoip_db_path: Option<String>,
}

impl Config {
    pub fn from_env() -> Self {
        let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
        let port = env::var("PORT")
            .unwrap_or_else(|_| "3000".to_string())
            .parse()
            .expect("PORT must be a number");

        let tunnel_port = env::var("TUNNEL_PORT")
            .unwrap_or_else(|_| "4000".to_string())
            .parse()
            .expect("TUNNEL_PORT must be a number");

        let redis_url =
            env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".to_string());

        let sticky_ttl_secs = env::var("STICKY_TTL_SECS")
            .unwrap_or_else(|_| "600".to_string())
            .parse()
            .expect("STICKY_TTL_SECS must be a number");

        let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| "secret".to_string());

        // In prod, this should fail if missing. For dev, we use a placeholder "00"*32
        let provider_private_key = env::var("PROVIDER_PRIVATE_KEY").unwrap_or_else(|_| {
            "0000000000000000000000000000000000000000000000000000000000000000".to_string()
        });

        let geoip_db_path = env::var("GEOIP_DB_PATH").ok();

        Self {
            host,
            port,
            tunnel_port,
            redis_url,
            sticky_ttl_secs,
            jwt_secret,
            provider_private_key,
            geoip_db_path,
        }
    }

    pub fn socket_addr(&self) -> SocketAddr {
        format!("{}:{}", self.host, self.port)
            .parse()
            .expect("Invalid address format")
    }
}
