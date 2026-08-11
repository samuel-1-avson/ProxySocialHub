package middleware

import (
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// DefaultTrustedProxies are the only peers trusted to set X-Forwarded-For
// on the live GCP Phase A path (host Caddy → loopback control-api).
var DefaultTrustedProxies = []string{"127.0.0.1", "::1"}

// ConfigureTrustedProxies restricts which peers may influence c.ClientIP()
// via X-Forwarded-For / X-Real-IP.
//
// TRUSTED_PROXIES:
//   - unset / empty → 127.0.0.1, ::1 (Caddy-on-host default)
//   - "none" | "false" | "off" → trust no proxies (ClientIP = RemoteAddr)
//   - comma-separated IPs/CIDRs → explicit allowlist
func ConfigureTrustedProxies(r *gin.Engine) error {
	proxies, mode := resolveTrustedProxies(os.Getenv("TRUSTED_PROXIES"))
	if err := r.SetTrustedProxies(proxies); err != nil {
		return err
	}
	// Ensure Gin evaluates forwarded headers only for trusted peers.
	r.ForwardedByClientIP = true
	_ = mode // reserved for logging at call site
	return nil
}

// ResolveTrustedProxiesForTest exposes parsing for unit tests.
func ResolveTrustedProxiesForTest(raw string) []string {
	proxies, _ := resolveTrustedProxies(raw)
	return proxies
}

func resolveTrustedProxies(raw string) ([]string, string) {
	raw = strings.TrimSpace(raw)
	switch strings.ToLower(raw) {
	case "none", "false", "off":
		return []string{}, "none"
	case "":
		out := make([]string, len(DefaultTrustedProxies))
		copy(out, DefaultTrustedProxies)
		return out, "default"
	default:
		parts := strings.Split(raw, ",")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if p != "" {
				out = append(out, p)
			}
		}
		if len(out) == 0 {
			out = make([]string, len(DefaultTrustedProxies))
			copy(out, DefaultTrustedProxies)
			return out, "default"
		}
		return out, "explicit"
	}
}
