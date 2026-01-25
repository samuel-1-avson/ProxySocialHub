package solana

import (
	"context"
	"crypto/ed25519"
	"encoding/binary"
	"fmt"
	"log"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// UsageStatement represents a signed claim of bandwidth usage
type UsageStatement struct {
	EscrowPDA   sol.PublicKey `json:"escrow_pda"`
	TotalBytes  uint64        `json:"total_bytes"`
	PeriodStart int64         `json:"period_start"`
	PeriodEnd   int64         `json:"period_end"`
	Signature   []byte        `json:"signature"`
	Signer      sol.PublicKey `json:"signer"`
}

// ProofService handles the creation and verification of bandwidth proofs
type ProofService struct {
	client *OracleClient
}

// NewProofService creates a new proof service
func NewProofService(client *OracleClient) *ProofService {
	return &ProofService{
		client: client,
	}
}

// CreateUsageStatement signs a statement for an escrow
func (s *ProofService) CreateUsageStatement(escrow sol.PublicKey, bytes uint64, start, end int64) (*UsageStatement, error) {
	// 1. Prepare data for signing
	msg := make([]byte, 32+8+8+8)
	copy(msg[0:32], escrow.Bytes())
	binary.LittleEndian.PutUint64(msg[32:40], bytes)
	binary.LittleEndian.PutUint64(msg[40:48], uint64(start))
	binary.LittleEndian.PutUint64(msg[48:56], uint64(end))

	// 2. Sign with Oracle/Provider key
	sig := ed25519.Sign(ed25519.PrivateKey(s.client.oracleKey), msg) // Correct type conversion

	return &UsageStatement{
		EscrowPDA:   escrow,
		TotalBytes:  bytes,
		PeriodStart: start,
		PeriodEnd:   end,
		Signature:   sig,
		Signer:      s.client.oracleKey.PublicKey(),
	}, nil
}

// SubmitProofToChain broadcasts the usage proof to Solana
func (s *ProofService) SubmitProofToChain(ctx context.Context, statement *UsageStatement, proofIndex uint32) (string, error) {
	log.Printf("[ProofService] Submitting usage proof for escrow %s: %v bytes",
		statement.EscrowPDA, statement.TotalBytes)

	// Broadcast to Solana
	txHash, err := s.client.SubmitUsageProof(ctx, SubmitUsageProofParams{
		EscrowPDA:   statement.EscrowPDA,
		ProofIndex:  proofIndex,
		TotalBytes:  statement.TotalBytes,
		PeriodStart: statement.PeriodStart,
		PeriodEnd:   statement.PeriodEnd,
	})
	if err != nil {
		return "", fmt.Errorf("failed to submit proof: %w", err)
	}

	// Update database state to reflect proof submission
	err = db.DB.Model(&models.UsageProof{}).Create(&models.UsageProof{
		ID:            uuid.New(),
		OrderID:       uuid.New(), // In real app, look up from escrow
		TotalBytes:    int64(statement.TotalBytes),
		OnChainTxHash: txHash,
		Status:        models.UsageProofOnChain,
		PeriodStart:   time.Unix(statement.PeriodStart, 0),
		PeriodEnd:     time.Unix(statement.PeriodEnd, 0),
	}).Error

	return txHash, err
}

// VerifyDualSignature verifies that both buyer and seller have signed a statement
func (s *ProofService) VerifyDualSignature(statement *UsageStatement, buyerSig, sellerSig []byte, buyer, seller sol.PublicKey) bool {
	msg := make([]byte, 32+8+8+8)
	copy(msg[0:32], statement.EscrowPDA.Bytes())
	binary.LittleEndian.PutUint64(msg[32:40], statement.TotalBytes)
	binary.LittleEndian.PutUint64(msg[40:48], uint64(statement.PeriodStart))
	binary.LittleEndian.PutUint64(msg[48:56], uint64(statement.PeriodEnd))

	buyerOK := ed25519.Verify(buyer.Bytes(), msg, buyerSig)
	sellerOK := ed25519.Verify(seller.Bytes(), msg, sellerSig)

	return buyerOK && sellerOK
}

var globalProofService *ProofService

func InitProofService(client *OracleClient) {
	globalProofService = NewProofService(client)
}

func GetProofService() *ProofService {
	return globalProofService
}
