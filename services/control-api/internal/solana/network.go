package solana

import (
	"os"
	"strings"
)

// IsMainnetNetwork reports whether the deployment targets Solana mainnet.
func IsMainnetNetwork(network string) bool {
	n := strings.ToLower(strings.TrimSpace(network))
	switch n {
	case "mainnet", "mainnet-beta", "mainnet_beta":
		return true
	default:
		return false
	}
}

// EffectiveSolanaNetwork returns the configured or oracle-reported Solana cluster name.
func EffectiveSolanaNetwork() string {
	if n := strings.TrimSpace(os.Getenv("SOLANA_NETWORK")); n != "" {
		return n
	}
	if oracle := GetOracleClient(); oracle != nil {
		if n := strings.TrimSpace(oracle.GetNetwork()); n != "" {
			return n
		}
	}
	return "devnet"
}
