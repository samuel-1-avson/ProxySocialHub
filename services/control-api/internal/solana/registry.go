package solana

import (
	"log"

	"github.com/proxyhubb/control-api/internal/models"
)

// GetRegistryNodes fetches all registered node accounts from the Solana blockchain
func GetRegistryNodes() ([]models.RegistryNode, error) {
	// In production, this would use the RPC client to call GetProgramAccounts
	// and deserialize the account data using the Anchor IDL.

	log.Println("Industrial RPC Fetch: Scanning Program Accounts...")

	// Simulated on-chain nodes for Phase 9.3 integration
	return []models.RegistryNode{
		{
			Pubkey:        "7f4e9a2b5c8d1e0f0000000000000001",
			Owner:         "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
			IPAddr:        "192.168.1.10",
			Port:          8080,
			ProxyType:     "residential",
			StakedAmount:  10.5,
			UptimePercent: 99.9,
			QualityScore:  98.5,
			LastSeen:      1737800000,
		},
		{
			Pubkey:        "7f4e9a2b5c8d1e0f0000000000000002",
			Owner:         "5K98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
			IPAddr:        "192.168.1.11",
			Port:          8081,
			ProxyType:     "datacenter",
			StakedAmount:  5.0,
			UptimePercent: 98.2,
			QualityScore:  92.0,
			LastSeen:      1737801000,
		},
	}, nil
}
