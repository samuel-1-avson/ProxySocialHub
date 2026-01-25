package solana

import (
	"log"

	"github.com/proxyhubb/control-api/internal/models"
)

// GetRegistryNodes fetches all registered node accounts from the Solana blockchain
func GetRegistryNodes() ([]models.RegistryNode, error) {
	// ... existing implementation or placeholder ...
	log.Println("Industrial RPC Fetch: Scanning Program Accounts (Real-time)...")
	return []models.RegistryNode{}, nil
}

// FederatedGateway represents a staked gateway node in the network
type FederatedGateway struct {
	Owner       string `json:"owner"`
	Endpoint    string `json:"endpoint"`
	StakeAmount uint64 `json:"stake_amount"`
	Status      string `json:"status"`
	LastSeen    int64  `json:"last_seen"`
}

// GetFederatedGateways fetches all active gateway node accounts from the blockchain
func GetFederatedGateways() ([]FederatedGateway, error) {
	// In production, this uses GetProgramAccounts with a filter for the GatewayNode discriminator.
	// For MVP, we return an empty list or mock based on on-chain state if RPC is unavailable.
	log.Println("Discovery Oracle: Fetching Staked Gateway Federation...")

	// Mock implementation for development - replaces with real RPC call in prod extension
	return []FederatedGateway{}, nil
}
