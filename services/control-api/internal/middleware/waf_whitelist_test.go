package middleware

import "testing"

// DP-5: the default WAF whitelist must not blanket-trust private ranges.
// Behind Docker or a cluster-internal hop, external traffic routinely
// presents an RFC1918 peer, which previously skipped every WAF check.
func TestDefaultWAFWhitelistIsLoopbackOnly(t *testing.T) {
	cfg := DefaultWAFConfig()

	for _, ip := range []string{"127.0.0.1", "::1"} {
		if !isIPWhitelisted(ip, cfg.WhitelistedIPs) {
			t.Errorf("loopback %s should stay whitelisted", ip)
		}
	}
	for _, ip := range []string{
		"10.0.0.5", "172.16.0.9", "172.31.255.254", "192.168.1.10", "203.0.113.7",
	} {
		if isIPWhitelisted(ip, cfg.WhitelistedIPs) {
			t.Errorf("%s must not be whitelisted by default", ip)
		}
	}
}
