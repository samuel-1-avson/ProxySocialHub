package api

import (
	"testing"
)

func TestProviderPublicTunnelAddrs_MergesRegistry(t *testing.T) {
	prev := registryTunnelAddrs
	t.Cleanup(func() { registryTunnelAddrs = prev })

	registryTunnelAddrs = func() []string {
		return []string{"reg.example:3128", "reg.example:3129", "reg.example:3128"}
	}
	t.Setenv("PROVIDER_TUNNEL_PUBLIC_ADDRS", "env.example:3129,reg.example:3128")

	got := providerPublicTunnelAddrs("primary.example:3128")
	want := []string{
		"primary.example:3128",
		"reg.example:3128",
		"reg.example:3129",
		"env.example:3129",
		"primary.example:8443",
	}
	if len(got) != len(want) {
		t.Fatalf("len got=%d want=%d got=%v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("idx %d got=%q want=%q full=%v", i, got[i], want[i], got)
		}
	}
}

func TestProviderPublicTunnelAddrs_NoRegistry(t *testing.T) {
	prev := registryTunnelAddrs
	t.Cleanup(func() { registryTunnelAddrs = prev })
	registryTunnelAddrs = func() []string { return nil }
	t.Setenv("PROVIDER_TUNNEL_PUBLIC_ADDRS", "")

	got := providerPublicTunnelAddrs("localhost:3128")
	if len(got) != 1 || got[0] != "localhost:3128" {
		t.Fatalf("got %v", got)
	}
}
