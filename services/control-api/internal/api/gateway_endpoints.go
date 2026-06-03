package api

import (
	"sync"

	"github.com/proxyhubb/control-api/internal/config"
)

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

// BuyerProxyConnectInfo returns host, port, and host:port for the buyer HTTP CONNECT listener (default :8090).
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
