package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ReconciliationHistory persists each reconciliation run result so that
// operators can query historical reports via the admin API.
// P2-09: Replaces the "not yet implemented" stub in GetLastReconciliationReport.
type ReconciliationHistory struct {
	ID uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`

	// Balances at the time of the run
	TreasuryBalanceSOL    float64 `gorm:"not null" json:"treasury_balance_sol"`
	InternalLiabilitiesSOL float64 `gorm:"not null" json:"internal_liabilities_sol"`
	DiscrepancySOL        float64 `gorm:"not null" json:"discrepancy_sol"`

	// Outcome
	Status string `gorm:"type:varchar(20);not null;index" json:"status"` // MATCHED, SURPLUS, DEFICIT, ERROR

	// Optional detail snapshot (JSON array of issues)
	IssuesJSON string `gorm:"type:jsonb;default:'[]'" json:"issues_json"`

	// Duration of the run
	DurationMs int64 `json:"duration_ms"`

	CreatedAt time.Time `gorm:"index" json:"created_at"`
}

func (ReconciliationHistory) TableName() string {
	return "reconciliation_history"
}

func (r *ReconciliationHistory) BeforeCreate(tx *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}
