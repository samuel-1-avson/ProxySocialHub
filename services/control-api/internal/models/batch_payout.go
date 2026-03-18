package models

import (
	"time"

	"github.com/google/uuid"
)

// BatchPayoutStatus represents the status of a batch payout
type BatchPayoutStatus string

const (
	BatchStatusPending    BatchPayoutStatus = "pending"
	BatchStatusProcessing BatchPayoutStatus = "processing"
	BatchStatusCompleted  BatchPayoutStatus = "completed"
	BatchStatusPartial    BatchPayoutStatus = "partial" // Some succeeded, some failed
	BatchStatusFailed     BatchPayoutStatus = "failed"
)

// BatchPayout represents a batch of provider payouts processed together
type BatchPayout struct {
	ID            uuid.UUID         `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Status        BatchPayoutStatus `gorm:"size:20;default:'pending';not null" json:"status"`
	TotalAmount   float64           `gorm:"type:decimal(20,9);not null" json:"total_amount"`
	TotalCount    int               `gorm:"not null" json:"total_count"`
	SuccessCount  int               `gorm:"default:0" json:"success_count"`
	FailedCount   int               `gorm:"default:0" json:"failed_count"`
	TxHash        *string           `gorm:"size:128" json:"tx_hash,omitempty"`
	GasFeeLamports int64            `gorm:"default:0" json:"gas_fee_lamports"`
	ProcessedAt   *time.Time        `json:"processed_at,omitempty"`
	ErrorMessage  *string           `gorm:"type:text" json:"error_message,omitempty"`
	CreatedAt     time.Time         `json:"created_at"`
	UpdatedAt     time.Time         `json:"updated_at"`

	// Relationships
	Items []BatchPayoutItem `gorm:"foreignKey:BatchID" json:"items,omitempty"`
}

// BatchPayoutItem represents an individual payout within a batch
type BatchPayoutItem struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	BatchID       uuid.UUID `gorm:"type:uuid;not null;index" json:"batch_id"`
	ProviderID    uuid.UUID `gorm:"type:uuid;not null;index" json:"provider_id"`
	WalletAddress string    `gorm:"size:64;not null" json:"wallet_address"`
	AmountSOL     float64   `gorm:"type:decimal(20,9);not null" json:"amount_sol"`
	Status        string    `gorm:"size:20;default:'pending';not null" json:"status"`
	ErrorMessage  *string   `gorm:"type:text" json:"error_message,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// PendingPayout represents a payout waiting to be batched
type PendingPayout struct {
	ID              uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ProviderID      uuid.UUID  `gorm:"type:uuid;not null;index:idx_pending_provider" json:"provider_id"`
	WalletAddress   string     `gorm:"size:64;not null" json:"wallet_address"`
	AmountSOL       float64    `gorm:"type:decimal(20,9);not null" json:"amount_sol"`
	Priority        int        `gorm:"default:0" json:"priority"` // Higher = process first
	IdempotencyKey  string     `gorm:"size:64;uniqueIndex" json:"idempotency_key"` // Prevents double-payout on retry
	QueuedAt        time.Time  `json:"queued_at"`
	ScheduledFor    *time.Time `json:"scheduled_for,omitempty"` // For delayed payouts
	Attempts        int        `gorm:"default:0" json:"attempts"`
	LastError       *string    `gorm:"type:text" json:"last_error,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// TableName overrides the table name for PendingPayout
type QueuedPayout struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	ProviderID    uuid.UUID `gorm:"type:uuid;not null" json:"provider_id"`
	WalletAddress string    `gorm:"size:64;not null" json:"wallet_address"`
	AmountSOL     float64   `json:"amount_sol"`
	Priority      int       `json:"priority"`
}

// BatchPayoutStats provides statistics about batch processing
type BatchPayoutStats struct {
	TotalBatches       int64   `json:"total_batches"`
	TotalPayouts       int64   `json:"total_payouts"`
	TotalAmountSOL     float64 `json:"total_amount_sol"`
	AverageBatchSize   float64 `json:"average_batch_size"`
	AverageGasPerPayout float64 `json:"average_gas_per_payout"`
	SavingsPercent     float64 `json:"savings_percent"` // Compared to individual transfers
}

// BatchConfig holds configuration for batch processing
type BatchConfig struct {
	// Minimum amount to trigger immediate batch (bypass queue)
	ImmediateThresholdSOL float64
	// Maximum batch size (number of payouts)
	MaxBatchSize int
	// Minimum batch size to process (don't process tiny batches)
	MinBatchSize int
	// Maximum time to wait before processing a partial batch
	MaxWaitTime time.Duration
	// Process batch every N minutes regardless of size
	ProcessInterval time.Duration
	// Gas estimation for single transfer (for savings calculation)
	SingleTransferGasLamports int64
	// Gas estimation per transfer in batch (usually lower)
	BatchTransferGasLamports int64
}

// DefaultBatchConfig returns recommended default configuration
func DefaultBatchConfig() BatchConfig {
	return BatchConfig{
		ImmediateThresholdSOL:     10.0, // Process immediately if >= 10 SOL
		MaxBatchSize:              20,   // Max 20 payouts per batch
		MinBatchSize:              5,    // Don't batch fewer than 5
		MaxWaitTime:               30 * time.Minute,
		ProcessInterval:           15 * time.Minute,
		SingleTransferGasLamports: 5000,  // 0.000005 SOL per single transfer
		BatchTransferGasLamports:  3500,  // 0.0000035 SOL per transfer in batch (30% savings)
	}
}

// CalculateSavings estimates gas savings from batching
func CalculateSavings(itemCount int, config BatchConfig) float64 {
	singleTotal := float64(itemCount) * float64(config.SingleTransferGasLamports)
	batchTotal := float64(itemCount) * float64(config.BatchTransferGasLamports)
	// Add base transaction cost for batch
	batchTotal += float64(config.SingleTransferGasLamports) * 0.5

	savings := singleTotal - batchTotal
	if savings < 0 {
		return 0
	}
	return savings / 1e9 // Convert lamports to SOL
}

// ShouldProcessBatch determines if a batch should be processed based on config
func ShouldProcessBatch(pendingCount int, oldestQueued time.Time, config BatchConfig) bool {
	// Process if we have enough items
	if pendingCount >= config.MinBatchSize {
		return true
	}

	// Process if oldest item is too old
	if time.Since(oldestQueued) > config.MaxWaitTime {
		return true
	}

	return false
}
