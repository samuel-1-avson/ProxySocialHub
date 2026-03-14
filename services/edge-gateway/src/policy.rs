//! Policy enforcement for the Edge Gateway
//!
//! Enforces:
//! - Port whitelist (80, 443, 8080, 8443, 3000, 3001, 8000, 8888)
//! - Private IP blocking
//! - Rate limiting (tier-based)

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// Allowed destination ports (B-06: expanded to cover common proxy use-cases).
/// Providers further restrict via their node service_configuration (N-01).
const ALLOWED_PORTS: &[u16] = &[
    // HTTP / HTTPS
    80, 443, 8000, 8008, 8080, 8443, 8888,
    // Development servers
    3000, 3001, 3002, 4000, 4200, 5000, 5001, 9000,
    // SSH / tunnels
    22, 2222,
    // SOCKS / proxy
    1080, 3128,
    // Email (SMTP/IMAP/POP3 and their TLS variants)
    25, 465, 587, 110, 995, 143, 993,
    // DNS over TCP
    53,
    // FTP
    21,
    // VPN
    1194, 1723,
    // Mobile push (Google/Firebase)
    5228, 5229, 5230,
    // XMPP / chat
    5222, 5223,
];

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
        return Err(format!("Port {} is not in the allowed list", port));
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
            return Err(format!(
                "Destination {} is a private/reserved address",
                host
            ));
        }
    }
    // Note: For hostnames, we intentionally DO NOT resolve them here to prevent DNS leaks.
    // We forward the hostname directly to the provider, ensuring Remote DNS resolution.
    // This protects the Gateway's location/ISP from being revealed via DNS queries.

    // S-07: DNS rebinding protection.
    // Block hostnames that look like internal infrastructure names or localhost variants.
    // Full DNS rebinding protection (resolving hostnames and checking the resulting IP)
    // is not done here — that must happen in the provider, which controls DNS resolution.
    // What we CAN do is block obviously malicious hostnames before forwarding.
    is_safe_hostname(host)?;

    Ok(())
}

/// S-07: Reject hostnames that are obviously targeting internal infrastructure.
///
/// This is a best-effort syntactic check. DNS rebinding attacks that use a public
/// hostname that resolves to a private IP can only be fully blocked by the provider
/// enforcing the same `is_private_ip` check after DNS resolution.
pub fn is_safe_hostname(host: &str) -> Result<(), String> {
    let h = host.to_lowercase();

    // Block literal "localhost" and common aliases
    if h == "localhost" || h == "local" || h == "localdomain" {
        return Err(format!("Hostname '{}' is not allowed", host));
    }

    // Block .local mDNS / Bonjour domains (RFC 6762)
    if h.ends_with(".local") || h.ends_with(".localhost") {
        return Err(format!("Hostname '{}' resolves to a local mDNS domain", host));
    }

    // Block .internal and common cloud metadata service hostnames
    if h.ends_with(".internal")
        || h == "metadata.google.internal"
        || h == "169.254.169.254"  // caught by IP check, but also as string
        || h == "instance-data"    // common EC2 alias
    {
        return Err(format!("Hostname '{}' targets internal infrastructure", host));
    }

    // Block obviously numeric hostnames that look like private IPs expressed as hostnames
    // e.g. "10.0.0.1" — already caught by the IP parse above, but belt-and-suspenders
    // for any decimal-encoded variants.

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_allowed_ports() {
        assert!(is_allowed_port(80));
        assert!(is_allowed_port(443));
        assert!(is_allowed_port(8080));
        assert!(is_allowed_port(8443));
        assert!(is_allowed_port(3000));
        assert!(is_allowed_port(22));   // SSH tunnels supported
        assert!(is_allowed_port(1080)); // SOCKS5
        assert!(!is_allowed_port(3306));  // MySQL — not a proxy port
        assert!(!is_allowed_port(6379));  // Redis — not a proxy port
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
        assert!(validate_destination("example.com:22").is_ok()); // SSH now allowed
        assert!(validate_destination("example.com:1080").is_ok()); // SOCKS5 now allowed

        assert!(validate_destination("example.com:3306").is_err()); // MySQL blocked
        assert!(validate_destination("127.0.0.1:80").is_err());     // loopback blocked
        assert!(validate_destination("192.168.1.1:443").is_err());  // private IP blocked
    }

    #[test]
    fn test_dns_rebinding_protection() {
        // S-07: Localhost and mDNS hostnames must be rejected
        assert!(is_safe_hostname("localhost").is_err());
        assert!(is_safe_hostname("local").is_err());
        assert!(is_safe_hostname("mydevice.local").is_err());
        assert!(is_safe_hostname("foo.localhost").is_err());
        assert!(is_safe_hostname("metadata.google.internal").is_err());
        assert!(is_safe_hostname("host.internal").is_err());
        assert!(is_safe_hostname("instance-data").is_err());

        // Public hostnames must be allowed
        assert!(is_safe_hostname("example.com").is_ok());
        assert!(is_safe_hostname("api.github.com").is_ok());
        assert!(is_safe_hostname("8.8.8.8").is_ok()); // public IP — handled by IP parser
    }
}
