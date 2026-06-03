package api

import (
	"testing"

	"github.com/proxyhubb/control-api/internal/config"
)

func TestBuyerProxyConnectInfo_after_init(t *testing.T) {
	InitGatewayEndpoints(config.GatewayConfig{
		BuyerProxyHost: "buyer.test",
		BuyerProxyPort: 8090,
	})
	host, port, endpoint := BuyerProxyConnectInfo()
	if host != "buyer.test" || port != 8090 || endpoint != "buyer.test:8090" {
		t.Fatalf("got host=%q port=%d endpoint=%q", host, port, endpoint)
	}
}
