package api

import (
	"fmt"
	"log"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// MilestoneReleaseEngine manages granular fund release based on usage checkpoints
type MilestoneReleaseEngine struct{}

func NewMilestoneReleaseEngine() *MilestoneReleaseEngine {
	return &MilestoneReleaseEngine{}
}

// CheckAndReleaseMilestones evaluates a session's usage and triggers payouts
func (e *MilestoneReleaseEngine) CheckAndReleaseMilestones(orderID uuid.UUID, totalBytes int64) error {
	var escrow models.EscrowTransaction
	if err := db.DB.Preload("Milestones").Where("order_id = ?", orderID).First(&escrow).Error; err != nil {
		return err
	}

	// P1-12: Validate that milestone amounts sum to the escrow amount.
	// This guards against over-payment if milestones were misconfigured.
	if len(escrow.Milestones) > 0 {
		var totalMilestone float64
		for _, m := range escrow.Milestones {
			totalMilestone += m.Amount
		}
		if math.Abs(totalMilestone-escrow.Amount) > 1e-6 {
			return fmt.Errorf("milestone amounts (%.9f SOL) do not match escrow amount (%.9f SOL) for order %s",
				totalMilestone, escrow.Amount, orderID)
		}
	}

	for _, m := range escrow.Milestones {
		if m.Status == "pending" && totalBytes >= m.ByteThreshold {
			log.Printf("[MilestoneEngine] Releasing milestone %s for order %s (Threshold: %d bytes)", m.ID, orderID, m.ByteThreshold)

			if err := e.releaseMilestone(escrow, m); err != nil {
				log.Printf("[MilestoneEngine] Failed to release milestone %s: %v", m.ID, err)
				continue
			}
		}
	}

	return nil
}

func (e *MilestoneReleaseEngine) releaseMilestone(escrow models.EscrowTransaction, milestone models.EscrowMilestone) error {
	return db.DB.Transaction(func(tx *gorm.DB) error {
		now := time.Now()

		var locked models.EscrowMilestone
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND status = ?", milestone.ID, "pending").
			First(&locked).Error; err != nil {
			return err
		}

		wallet, err := models.LockWalletForUpdate(tx, escrow.SellerID)
		if err != nil {
			return err
		}
		if err := models.CreditWalletLocked(tx, wallet, locked.Amount, models.LedgerKindMilestoneRelease,
			locked.ID.String(), "Progressive milestone payout for bandwidth delivery"); err != nil {
			return err
		}

		res := tx.Model(&locked).Updates(map[string]interface{}{
			"status":      "released",
			"released_at": now,
		})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return fmt.Errorf("milestone %s already released", locked.ID)
		}
		return nil
	})
}
