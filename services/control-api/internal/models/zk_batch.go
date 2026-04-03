package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ZKBatchStatus string

const (
	ZKBatchPending   ZKBatchStatus = "pending"    // Generated, not yet submitted on-chain
	ZKBatchSubmitted ZKBatchStatus = "submitted"  // TX sent, awaiting confirmation
	ZKBatchConfirmed ZKBatchStatus = "confirmed"  // Finalized on-chain
	ZKBatchFailed    ZKBatchStatus = "failed"     // On-chain submission failed
)

// ZKBatch represents an aggregated batch of N session usage proofs committed
// to Solana as a single Merkle root TX (Phase 4).
// In Phase 5, the ProofBytes field will carry a Halo2 ZK proof.
type ZKBatch struct {
	ID           uuid.UUID     `gorm:"type:uuid;primary_key" json:"id"`
	BatchRoot    string        `gorm:"type:varchar(64);not null;uniqueIndex" json:"batch_root"` // hex-encoded [32]byte
	SessionCount uint32        `gorm:"not null" json:"session_count"`
	TotalBytes   uint64        `gorm:"not null" json:"total_bytes"`
	PeriodStart  time.Time     `json:"period_start"`
	PeriodEnd    time.Time     `json:"period_end"`

	// On-chain settlement
	OnChainTxSig string        `gorm:"type:varchar(88)" json:"on_chain_tx_sig,omitempty"`
	OnChainSlot  int64         `json:"on_chain_slot,omitempty"`

	// Phase 5: Halo2 proof bytes (nil until prover is integrated)
	ProofBytes []byte `gorm:"type:bytea" json:"proof_bytes,omitempty"`

	Status    ZKBatchStatus `gorm:"type:varchar(20);default:'pending'" json:"status"`
	CreatedAt time.Time     `json:"created_at"`
	UpdatedAt time.Time     `json:"updated_at"`
}

func (ZKBatch) TableName() string { return "zk_batches" }

func (b *ZKBatch) BeforeCreate(tx *gorm.DB) error {
	if b.ID == uuid.Nil {
		b.ID = uuid.New()
	}
	return nil
}
