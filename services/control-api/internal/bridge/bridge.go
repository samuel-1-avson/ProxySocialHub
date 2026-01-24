package bridge

import (
	"context"
	"fmt"

	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/solana"
)

// ChainID represents a supported blockchain
type ChainID string

const (
	ChainSolana    ChainID = "solana"
	ChainEthereum  ChainID = "ethereum"
	ChainBittensor ChainID = "bittensor"
)

// BridgeService orchestrates cross-chain transfers
type BridgeService struct {
	solana    *SolanaAdapter
	bittensor *BittensorAdapter
}

func NewService(solClient *solana.OracleClient) (*BridgeService, error) {
	solAdapter, err := NewSolanaAdapter(solClient)
	if err != nil {
		return nil, err
	}

	return &BridgeService{
		solana:    solAdapter,
		bittensor: NewBittensorAdapter(),
	}, nil
}

// TransferResult contains the outcome of a bridge operation
type TransferResult struct {
	SourceTx     string  `json:"source_tx"`
	DestTx       string  `json:"dest_tx"`
	AmountSource uint64  `json:"amount_source"` // Lamports
	AmountDest   float64 `json:"amount_dest"`   // TAO
	Status       string  `json:"status"`
}

// ProcessSolanaToBittensor verifies a SOL deposit and sends TAO
func (s *BridgeService) ProcessSolanaToBittensor(ctx context.Context, solanaTxHash string, bittensorDest string) (*TransferResult, error) {
	logging.Info().Str("tx", solanaTxHash).Str("dest", bittensorDest).Msg("Processing Solana->Bittensor bridge")

	// 1. Verify Solana Deposit
	// This checks if the Tx is finalized and sent to our Vault
	amountLamports, err := s.solana.VerifyDeposit(ctx, solanaTxHash)
	if err != nil {
		return nil, fmt.Errorf("deposit verification failed: %w", err)
	}

	// 2. Calculate Exchange Rate / Amount
	// For MVP, simplistic 1 SOL = 1 TAO logic or fixed rate
	// In prod, fetch live rates
	// 1 SOL = 1e9 Lamports. 1 TAO = 1e9 Rao.
	// Let's assume 1 SOL ~ X TAO.
	// Validating strict rates is out of scope, using 1:1 ratio for mechanics

	amountSOL := solana.LamportsToSOL(amountLamports)
	// Apply fee (e.g. 1%)
	fee := amountSOL * 0.01
	amountTAO := amountSOL - fee

	if amountTAO <= 0 {
		return nil, fmt.Errorf("amount too small after fees")
	}

	// 3. Initiate Bittensor Transfer (Release)
	logging.Info().Float64("amount_tao", amountTAO).Msg("Releasing funds on Bittensor")

	destTxHash, err := s.bittensor.SendTAO(ctx, bittensorDest, amountTAO)
	if err != nil {
		logging.Error(err).Msg("Failed to release TAO")
		// CRITICAL: Failed to release but deposit verified.
		// In production, this needs a "Pending/Retry" queue.
		// For MVP, we return error.
		return nil, fmt.Errorf("failed to send TAO: %w", err)
	}

	// 4. Return Success
	return &TransferResult{
		SourceTx:     solanaTxHash,
		DestTx:       destTxHash,
		AmountSource: amountLamports,
		AmountDest:   amountTAO,
		Status:       "completed",
	}, nil
}

// ProcessBittensorToSolana would verify a Tao transfer and release SOL
// Requires scanning Bittensor blocks or a trusted event stream
func (s *BridgeService) ProcessBittensorToSolana(ctx context.Context, bittensorTxHash string, solanaDest string) (*TransferResult, error) {
	return nil, fmt.Errorf("not implemented yet")
}
