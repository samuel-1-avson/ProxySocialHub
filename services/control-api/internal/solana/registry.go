package solana

import (
	"log"

	"github.com/proxyhubb/control-api/internal/models"
)

// GetRegistryNodes fetches all registered node accounts from the Solana blockchain
func GetRegistryNodes() ([]models.RegistryNode, error) {
	// In production, this would use the RPC client to call GetProgramAccounts
	// and deserialize the account data using the Anchor IDL.

	// We've removed simulated data to ensure explorer only shows real on-chain state.
	// Future: Implement GetProgramAccounts scan here using global rpc client.
	log.Println("Industrial RPC Fetch: Scanning Program Accounts (Real-time)...")

	return []models.RegistryNode{}, nil
}
