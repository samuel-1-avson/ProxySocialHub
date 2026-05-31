package api

import (
	"os"
)

// SolscanCluster returns the Solscan cluster query param (empty for mainnet).
func SolscanCluster() string {
	n := os.Getenv("SOLANA_NETWORK")
	if n == "" {
		return "devnet"
	}
	if n == "mainnet-beta" || n == "mainnet" {
		return "mainnet"
	}
	return n
}

// SolscanTxURL builds a Solscan transaction URL for the current network.
func SolscanTxURL(signature string) string {
	return solscanTxURL(signature, SolscanCluster())
}

// SolscanAccountURL builds a Solscan account URL for the current network.
func SolscanAccountURL(address string) string {
	cluster := SolscanCluster()
	if cluster == "" || cluster == "mainnet" {
		return "https://solscan.io/account/" + address
	}
	return "https://solscan.io/account/" + address + "?cluster=" + cluster
}

func solscanTxURL(signature, cluster string) string {
	if cluster == "" || cluster == "mainnet" {
		return "https://solscan.io/tx/" + signature
	}
	return "https://solscan.io/tx/" + signature + "?cluster=" + cluster
}
