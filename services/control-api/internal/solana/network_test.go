package solana

import "testing"

func TestIsMainnetNetwork(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{"mainnet", true},
		{"mainnet-beta", true},
		{"mainnet_beta", true},
		{"MAINNET", true},
		{"devnet", false},
		{"testnet", false},
		{"", false},
	}
	for _, tc := range tests {
		if got := IsMainnetNetwork(tc.in); got != tc.want {
			t.Fatalf("IsMainnetNetwork(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
