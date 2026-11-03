package api

import (
	"os"
	"strings"
	"sync"

	"github.com/proxyhubb/control-api/internal/config"
)

// TLS is the public default. Plain HTTP must be explicitly selected for local
// development; the server and edge reject it in strict environments.
func buyerProxyScheme() string {
	for _, name := range []string{"ENVIRONMENT", "APP_ENV", "GO_ENV"} {
		switch strings.ToLower(strings.TrimSpace(os.Getenv(name))) {
		case "production", "prod", "staging", "testnet":
			return "https"
		}
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("BUYER_PROXY_SCHEME")), "http") {
		return "http"
	}
	return "https"
}

var (
	gatewayMu         sync.RWMutex
	gatewayCfg        config.GatewayConfig
	gatewayConfigured bool
)

// InitGatewayEndpoints stores buyer-facing edge-gateway CONNECT coordinates from config.Load().
func InitGatewayEndpoints(g config.GatewayConfig) {
	gatewayMu.Lock()
	defer gatewayMu.Unlock()
	gatewayCfg = g
	gatewayConfigured = true
}

// BuyerProxyConnectInfo returns host, port, and host:port for the buyer HTTP CONNECT
// / SOCKS5 listener (default :8090). Absolute-URI forward proxy is not supported
// (edge-gateway returns 501) — see docs/buyer-proxy.md.
func BuyerProxyConnectInfo() (host string, port int, endpoint string) {
	gatewayMu.RLock()
	g := gatewayCfg
	configured := gatewayConfigured
	gatewayMu.RUnlock()

	if !configured {
		g = config.GatewayConfig{
			BuyerProxyHost: "proxy.proxyhubb.com",
			BuyerProxyPort: 8090,
		}
	}

	endpoint = g.BuyerProxyEndpoint()
	host = g.BuyerProxyHostOnly()
	port = g.BuyerProxyPortOnly()
	return host, port, endpoint
}
