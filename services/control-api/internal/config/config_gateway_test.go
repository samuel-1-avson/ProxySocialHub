package config

import "testing"

func TestGatewayConfig_BuyerProxyEndpoint_defaults(t *testing.T) {
	g := GatewayConfig{}
	if got := g.BuyerProxyEndpoint(); got != "proxy.proxyhubb.com:8090" {
		t.Fatalf("expected default buyer endpoint, got %q", got)
	}
	if g.BuyerProxyPortOnly() != 8090 {
		t.Fatalf("expected port 8090, got %d", g.BuyerProxyPortOnly())
	}
}

func TestGatewayConfig_BuyerProxyEndpoint_custom(t *testing.T) {
	g := GatewayConfig{
		BuyerProxyHost: "edge.example.com",
		BuyerProxyPort: 8090,
	}
	if got := g.BuyerProxyEndpoint(); got != "edge.example.com:8090" {
		t.Fatalf("unexpected endpoint %q", got)
	}
}
