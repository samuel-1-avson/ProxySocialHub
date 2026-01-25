package api

import (
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
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
	tx := db.DB.Begin()
	now := time.Now()

	// 1. Update Milestone Status
	if err := tx.Model(&milestone).Updates(map[string]interface{}{
		"status":      "released",
		"released_at": now,
	}).Error; err != nil {
		tx.Rollback()
		return err
	}

	// 2. Credit Seller Wallet
	var wallet models.Wallet
	if err := tx.First(&wallet, "user_id = ?", escrow.SellerID).Error; err != nil {
		tx.Rollback()
		return err
	}

	// For Phase 10.3, assume base GHS/SOL balance update
	newBalance := wallet.BalanceGHS + milestone.Amount
	if err := tx.Model(&wallet).Update("balance_ghs", newBalance).Error; err != nil {
		tx.Rollback()
		return err
	}

	// 3. Log Ledger Entry
	ledger := models.WalletLedgerEntry{
		WalletID:     wallet.ID,
		Amount:       milestone.Amount,
		BalanceAfter: newBalance,
		Type:         "milestone_release",
		ReferenceID:  milestone.ID.String(),
		Description:  "Progressive milestone payout for bandwidth delivery",
	}
	if err := tx.Create(&ledger).Error; err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit().Error
}
