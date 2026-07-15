package geoip

import (
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// IsLANIP reports whether ip is a private RFC1918 IPv4 address.
func IsLANIP(ip net.IP) bool {
	ip4 := ip.To4()
	if ip4 == nil {
		return false
	}
	return ip4[0] == 10 ||
		(ip4[0] == 172 && ip4[1] >= 16 && ip4[1] <= 31) ||
		(ip4[0] == 192 && ip4[1] == 168)
}

// NeedsPublicIPLookup returns true when the address cannot be used for GeoIP lookup.
func NeedsPublicIPLookup(ip string) bool {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return true
	}
	parsed := net.ParseIP(ip)
	if parsed == nil || parsed.IsLoopback() || IsLANIP(parsed) {
		return true
	}
	return false
}

var (
	publicIPMu        sync.Mutex
	cachedPublicIP    string
	cachedPublicIPAt  time.Time
	publicIPCacheTTL  = 5 * time.Minute
	publicIPEndpoint  = "https://api.ipify.org?format=text"
	publicIPHTTPClient = &http.Client{Timeout: 5 * time.Second}
)

func init() {
	if ep := strings.TrimSpace(os.Getenv("GEOIP_PUBLIC_IP_ENDPOINT")); ep != "" {
		publicIPEndpoint = ep
	}
}

// DetectPublicIP returns this host's public WAN address (via ipify or GEOIP_PUBLIC_IP_ENDPOINT).
func DetectPublicIP() (string, bool) {
	publicIPMu.Lock()
	defer publicIPMu.Unlock()

	if cachedPublicIP != "" && time.Since(cachedPublicIPAt) < publicIPCacheTTL {
		return cachedPublicIP, true
	}

	resp, err := publicIPHTTPClient.Get(publicIPEndpoint)
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", false
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64))
	if err != nil {
		return "", false
	}
	ip := strings.TrimSpace(string(body))
	if NeedsPublicIPLookup(ip) {
		return "", false
	}

	cachedPublicIP = ip
	cachedPublicIPAt = time.Now()
	return ip, true
}

// NormalizeIPForGeo returns a public IP suitable for GeoIP lookup.
// Private, loopback, and empty inputs are replaced with the detected WAN IP when possible.
func NormalizeIPForGeo(ip string) string {
	ip = strings.TrimSpace(ip)
	if !NeedsPublicIPLookup(ip) {
		return ip
	}
	if public, ok := DetectPublicIP(); ok {
		return public
	}
	return ip
}
