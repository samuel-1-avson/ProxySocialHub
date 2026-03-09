package bridge

import (
	"github.com/proxyhubb/control-api/internal/solana"
)

// ChainID represents a supported blockchain
type ChainID string

const (
	ChainSolana   ChainID = "solana"
	ChainEthereum ChainID = "ethereum"
)

// BridgeService orchestrates cross-chain transfers
type BridgeService struct {
	solana *SolanaAdapter
}

func NewService(solClient *solana.OracleClient) (*BridgeService, error) {
	solAdapter, err := NewSolanaAdapter(solClient)
	if err != nil {
		return nil, err
	}

	return &BridgeService{
		solana: solAdapter,
	}, nil
}

// TransferResult contains the outcome of a bridge operation
type TransferResult struct {
	SourceTx     string `json:"source_tx"`
	DestTx       string `json:"dest_tx"`
	AmountSource uint64 `json:"amount_source"` // Lamports
	Status       string `json:"status"`
}
