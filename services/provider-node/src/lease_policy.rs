use std::env;

/// Mirrors edge-gateway `provider_leases_required()` so CLI behavior matches tunnel policy.
pub fn provider_leases_required() -> bool {
    if let Ok(raw) = env::var("REQUIRE_PROVIDER_LEASE") {
        let value = raw.trim().to_ascii_lowercase();
        return matches!(value.as_str(), "1" | "true" | "yes" | "on");
    }

    for key in ["APP_ENV", "GO_ENV", "RUST_ENV", "ENVIRONMENT"] {
        if let Ok(raw) = env::var(key) {
            let value = raw.trim().to_ascii_lowercase();
            if matches!(value.as_str(), "development" | "dev" | "local" | "test") {
                return false;
            }
            return true;
        }
    }

    !cfg!(debug_assertions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env lock")
    }

    #[test]
    fn development_env_disables_required_lease() {
        let _guard = env_lock();
        let previous = env::var("APP_ENV").ok();
        env::set_var("APP_ENV", "development");
        assert!(!provider_leases_required());
        match previous {
            Some(value) => env::set_var("APP_ENV", value),
            None => env::remove_var("APP_ENV"),
        }
    }
}
