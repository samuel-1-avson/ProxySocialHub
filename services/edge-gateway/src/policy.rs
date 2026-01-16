//! Policy enforcement for the Edge Gateway
//! 
//! Enforces:
//! - Port whitelist (80, 443 only for v1)
//! - Private IP blocking
//! - Rate limiting (tier-based)

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// Allowed destination ports for v1
const ALLOWED_PORTS: &[u16] = &[80, 443];

/// Check if a destination port is allowed
pub fn is_allowed_port(port: u16) -> bool {
    ALLOWED_PORTS.contains(&port)
}

/// Check if an IP address is private/reserved (should be blocked)
pub fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => is_private_ipv4(ipv4),
        IpAddr::V6(ipv6) => is_private_ipv6(ipv6),
    }
}

fn is_private_ipv4(ip: &Ipv4Addr) -> bool {
    // Loopback: 127.0.0.0/8
    if ip.is_loopback() {
        return true;
    }
    
    // Private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
    if ip.is_private() {
        return true;
    }
    
    // Link-local: 169.254.0.0/16
    if ip.is_link_local() {
        return true;
    }
    
    // Broadcast: 255.255.255.255
    if ip.is_broadcast() {
        return true;
    }
    
    // Cloud metadata: 169.254.169.254 (AWS, GCP, Azure)
    if ip.octets() == [169, 254, 169, 254] {
        return true;
    }
    
    // AWS IMDS v2: 169.254.170.2
    if ip.octets() == [169, 254, 170, 2] {
        return true;
    }
    
    false
}

fn is_private_ipv6(ip: &Ipv6Addr) -> bool {
    // Loopback: ::1
    if ip.is_loopback() {
        return true;
    }
    
    // Unspecified: ::
    if ip.is_unspecified() {
        return true;
    }
    
    // IPv4-mapped addresses: check the embedded IPv4
    if let Some(ipv4) = ip.to_ipv4_mapped() {
        return is_private_ipv4(&ipv4);
    }
    
    // Unique local addresses (fc00::/7) - private
    let segments = ip.segments();
    if (segments[0] & 0xfe00) == 0xfc00 {
        return true;
    }
    
    // Link-local (fe80::/10)
    if (segments[0] & 0xffc0) == 0xfe80 {
        return true;
    }
    
    false
}

/// Parse host:port string and extract port
pub fn parse_port(addr: &str) -> Option<u16> {
    // Handle IPv6 addresses like [::1]:443
    if addr.starts_with('[') {
        // IPv6 format: [host]:port
        if let Some(bracket_end) = addr.rfind(']') {
            if addr.len() > bracket_end + 2 && addr.chars().nth(bracket_end + 1) == Some(':') {
                return addr[bracket_end + 2..].parse().ok();
            }
        }
        return None;
    }
    
    // IPv4 or hostname format: host:port
    if let Some(colon_pos) = addr.rfind(':') {
        return addr[colon_pos + 1..].parse().ok();
    }
    
    None
}

/// Validate a destination address against policy rules
/// Returns Ok(()) if allowed, Err(reason) if blocked
pub fn validate_destination(addr: &str) -> Result<(), String> {
    // 1. Extract port
    let port = parse_port(addr).ok_or_else(|| "Invalid address format".to_string())?;
    
    // 2. Check port whitelist
    if !is_allowed_port(port) {
        return Err(format!("Port {} is not allowed. Only HTTP (80) and HTTPS (443) are permitted.", port));
    }
    
    // 3. Try to parse as IP and check if private
    // Extract host part
    let host = if addr.starts_with('[') {
        // IPv6: [host]:port
        addr.split(']').next().map(|s| &s[1..]).unwrap_or("")
    } else {
        // IPv4 or hostname: host:port
        addr.split(':').next().unwrap_or("")
    };
    
    // If it's an IP address, validate it
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_ip(&ip) {
            return Err(format!("Destination {} is a private/reserved address", host));
        }
    }
    // Note: For hostnames, we allow them through. The provider will resolve them.
    // DNS-based blocking could be added later if needed.
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_allowed_ports() {
        assert!(is_allowed_port(80));
        assert!(is_allowed_port(443));
        assert!(!is_allowed_port(22));
        assert!(!is_allowed_port(8080));
        assert!(!is_allowed_port(3306));
    }
    
    #[test]
    fn test_private_ips() {
        assert!(is_private_ip(&"127.0.0.1".parse().unwrap()));
        assert!(is_private_ip(&"10.0.0.1".parse().unwrap()));
        assert!(is_private_ip(&"192.168.1.1".parse().unwrap()));
        assert!(is_private_ip(&"172.16.0.1".parse().unwrap()));
        assert!(is_private_ip(&"169.254.169.254".parse().unwrap()));
        
        assert!(!is_private_ip(&"8.8.8.8".parse().unwrap()));
        assert!(!is_private_ip(&"1.1.1.1".parse().unwrap()));
    }
    
    #[test]
    fn test_parse_port() {
        assert_eq!(parse_port("example.com:443"), Some(443));
        assert_eq!(parse_port("example.com:80"), Some(80));
        assert_eq!(parse_port("[::1]:443"), Some(443));
        assert_eq!(parse_port("192.168.1.1:8080"), Some(8080));
    }
    
    #[test]
    fn test_validate_destination() {
        assert!(validate_destination("example.com:443").is_ok());
        assert!(validate_destination("example.com:80").is_ok());
        
        assert!(validate_destination("example.com:22").is_err());
        assert!(validate_destination("127.0.0.1:80").is_err());
        assert!(validate_destination("192.168.1.1:443").is_err());
    }
}
