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
	publicIPMu         sync.Mutex
	cachedPublicIP     string
	cachedPublicIPAt   time.Time
	publicIPCacheTTL   = 5 * time.Minute
	publicIPEndpoint   = "https://api.ipify.org?format=text"
	publicIPHTTPClient = &http.Client{Timeout: 5 * time.Second}

	controlPlaneMu    sync.Mutex
	controlPlaneCache map[string]struct{}
	controlPlaneAt    time.Time
)

func init() {
	if ep := strings.TrimSpace(os.Getenv("GEOIP_PUBLIC_IP_ENDPOINT")); ep != "" {
		publicIPEndpoint = ep
	}
	controlPlaneCache = map[string]struct{}{}
	for _, ip := range splitCSV(os.Getenv("CONTROL_PLANE_PUBLIC_IPS")) {
		controlPlaneCache[ip] = struct{}{}
	}
}

func splitCSV(raw string) []string {
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ' ' || r == ';' || r == '\n' || r == '\t'
	})
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" || NeedsPublicIPLookup(p) {
			continue
		}
		out = append(out, p)
	}
	return out
}

func rememberControlPlaneIP(ip string) {
	ip = strings.TrimSpace(ip)
	if NeedsPublicIPLookup(ip) {
		return
	}
	controlPlaneMu.Lock()
	controlPlaneCache[ip] = struct{}{}
	controlPlaneMu.Unlock()
}

// DetectPublicIP returns this host's public WAN address (via ipify, GCP metadata,
// or GEOIP_PUBLIC_IP_ENDPOINT).
func DetectPublicIP() (string, bool) {
	publicIPMu.Lock()
	defer publicIPMu.Unlock()

	if cachedPublicIP != "" && time.Since(cachedPublicIPAt) < publicIPCacheTTL {
		return cachedPublicIP, true
	}

	if ip, ok := fetchTextIP(publicIPEndpoint, nil); ok {
		cachedPublicIP = ip
		cachedPublicIPAt = time.Now()
		rememberControlPlaneIP(ip)
		return ip, true
	}
	// GCE VMs often cannot reach ipify from restricted egress; metadata works.
	if ip, ok := fetchGCPExternalIP(); ok {
		cachedPublicIP = ip
		cachedPublicIPAt = time.Now()
		rememberControlPlaneIP(ip)
		return ip, true
	}
	return "", false
}

func fetchTextIP(url string, headers map[string]string) (string, bool) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", false
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := publicIPHTTPClient.Do(req)
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
	return ip, true
}

func fetchGCPExternalIP() (string, bool) {
	return fetchTextIP(
		"http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip",
		map[string]string{"Metadata-Flavor": "Google"},
	)
}

func refreshControlPlaneIPs() {
	controlPlaneMu.Lock()
	stale := time.Since(controlPlaneAt) > publicIPCacheTTL
	controlPlaneMu.Unlock()
	if !stale && len(controlPlaneCache) > 0 {
		return
	}
	if pub, ok := DetectPublicIP(); ok {
		rememberControlPlaneIP(pub)
	} else if ip, ok := fetchGCPExternalIP(); ok {
		rememberControlPlaneIP(ip)
	}
	controlPlaneMu.Lock()
	controlPlaneAt = time.Now()
	controlPlaneMu.Unlock()
}

// NormalizeIPForGeo returns ip when it is a public address suitable for GeoIP.
// Private, loopback, and empty inputs are left unchanged and are NOT replaced with
// this host's WAN IP — that incorrectly pinned every LAN/tunnel peer to the
// control-api region (e.g. GCP Midwest → Chicago) instead of the provider's home.
func NormalizeIPForGeo(ip string) string {
	return strings.TrimSpace(ip)
}

// PublicIPForGeo returns a public IP usable for GeoIP lookup, or "" when ip cannot
// be geolocated (empty, loopback, or RFC1918).
func PublicIPForGeo(ip string) string {
	ip = strings.TrimSpace(ip)
	if NeedsPublicIPLookup(ip) {
		return ""
	}
	return ip
}

// IsControlPlanePublicIP reports whether ip is this host's own WAN address.
// Provider nodes must never be keyed to the control-api/edge host IP — that is
// what pinned Ghana providers to Chicago (GCP Midwest hub).
func IsControlPlanePublicIP(ip string) bool {
	ip = strings.TrimSpace(ip)
	if NeedsPublicIPLookup(ip) {
		return false
	}
	refreshControlPlaneIPs()
	controlPlaneMu.Lock()
	_, known := controlPlaneCache[ip]
	controlPlaneMu.Unlock()
	if known {
		return true
	}
	if pub, ok := DetectPublicIP(); ok && pub == ip {
		rememberControlPlaneIP(ip)
		return true
	}
	return false
}

// IsCloudEgressIP reports whether a public IP GeoIP-resolves to a cloud/datacenter ISP.
func IsCloudEgressIP(ip string) bool {
	ip = PublicIPForGeo(ip)
	if ip == "" || IsControlPlanePublicIP(ip) {
		return IsControlPlanePublicIP(ip)
	}
	if result, ok := Resolve(ip); ok {
		return IsCloudHostedISP(result.ISP)
	}
	return false
}

// ProviderIPForStorage returns an IP safe to persist on a provider node.
// Control-plane WAN and LAN/empty values are rejected (return "").
func ProviderIPForStorage(ip string) string {
	ip = strings.TrimSpace(ip)
	if NeedsPublicIPLookup(ip) || IsControlPlanePublicIP(ip) {
		return ""
	}
	return ip
}

// IsUntrustedGatewayGeo reports whether gateway-advertised IP/ISP must not drive
// map location (control-plane WAN or cloud/datacenter MaxMind).
func IsUntrustedGatewayGeo(ip, isp string) bool {
	if IsControlPlanePublicIP(ip) {
		return true
	}
	if IsCloudHostedISP(isp) {
		return true
	}
	ip = PublicIPForGeo(ip)
	if ip == "" {
		return false
	}
	if result, ok := Resolve(ip); ok && IsCloudHostedISP(result.ISP) {
		// Cache so later IsControlPlanePublicIP checks stay cheap if this is host WAN.
		if IsControlPlanePublicIP(ip) {
			return true
		}
		return true
	}
	return false
}
