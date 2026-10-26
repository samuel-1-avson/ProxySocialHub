package api

import (
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/alerts"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/orders/fsm"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// W-24: stale-releasing reaper.
//
// Auto-release claims escrows held -> releasing, settles on-chain, then
// finalizes. A crash, RPC stall, or finalize failure between claim and
// finalize parked the escrow in `releasing` FOREVER: buyer couldn't
// dispute a terminal-looking escrow, seller never got paid, recon
// counted it as held. This reaper drives every stale `releasing` row to
// a decision using durable evidence only:
//
//   - dispute open            -> disputed (dispute precedence)
//   - custodial (no PDA)      -> back to held (no on-chain risk; the
//     conditional finalize tx never credited anyone)
//   - PDA + settle outbox succeeded -> finalize released (no credit:
//     the seller was paid on-chain)
//   - PDA + settle outbox pending   -> leave (retry in flight)
//   - PDA + no settle evidence     -> leave + CRITICAL alert (settle may
//     have landed; reclaiming could double-settle - ops must decide)
const staleReleasingAfter = 15 * time.Minute

type ReapResult struct {
	ReclaimedHeld  int
	ParkedDisputed int
	Finalized      int
	LeftForRetry   int
	NeedsOps       int
}

func ReapStaleReleasingEscrows() ReapResult {
	var res ReapResult
	var stale []models.EscrowTransaction
	cutoff := time.Now().Add(-staleReleasingAfter)
	if err := db.DB.Where("status = ? AND updated_at < ?", models.EscrowReleasing, cutoff).
		Limit(50).Find(&stale).Error; err != nil {
		log.Printf("[escrow] reaper query failed: %v", err)
		return res
	}
	for _, escrow := range stale {
		var order models.Order
		if err := db.DB.First(&order, "id = ?", escrow.OrderID).Error; err != nil {
			log.Printf("[escrow] reaper: order missing for escrow %s: %v", escrow.ID, err)
			res.NeedsOps++
			continue
		}

		if reason := autoReleaseBlockReason(&order, &escrow); reason != "" {
			parkEscrowDisputed(escrow.ID)
			res.ParkedDisputed++
			continue
		}

		hasPDA := order.EscrowPDA != "" && order.SellerWallet != ""
		if !hasPDA {
			reclaimEscrowToHeld(escrow.ID)
			res.ReclaimedHeld++
			continue
		}

		var outbox models.CompensationOutbox
		ref := "escrow_settle:" + order.ID.String()
		err := db.DB.Where("kind = ? AND reference_id = ?", models.CompensationKindEscrowSettle, ref).First(&outbox).Error
		switch {
		case err == nil && outbox.Status == models.CompensationStatusSucceeded:
			if ferr := finalizeReapedEscrow(&escrow, &order); ferr != nil {
				log.Printf("[escrow] reaper finalize failed escrow=%s: %v", escrow.ID, ferr)
				res.NeedsOps++
			} else {
				res.Finalized++
			}
		case err == nil && outbox.Status == models.CompensationStatusPending:
			res.LeftForRetry++
		default:
			res.NeedsOps++
			alerts.Send(alerts.Critical, "Stale Releasing Escrow Needs Ops Review",
				fmt.Sprintf("escrow=%s order=%s stuck in releasing > %s with no settle evidence (outbox err=%v)", escrow.ID, order.ID, staleReleasingAfter, err))
		}
	}
	if res != (ReapResult{}) {
		log.Printf("[escrow] reaper: reclaimed=%d disputed=%d finalized=%d left_retry=%d needs_ops=%d",
			res.ReclaimedHeld, res.ParkedDisputed, res.Finalized, res.LeftForRetry, res.NeedsOps)
	}
	return res
}

// finalizeReapedEscrow marks a PDA escrow released after proven on-chain
// settle (outbox succeeded). Never custodial-credits (paid on-chain).
func finalizeReapedEscrow(escrow *models.EscrowTransaction, order *models.Order) error {
	now := time.Now()
	return db.DB.Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&models.EscrowTransaction{}).
			Where("id = ? AND status = ?", escrow.ID, models.EscrowReleasing).
			Updates(map[string]interface{}{"status": models.EscrowReleased, "released_at": now})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return fmt.Errorf("escrow %s no longer releasing", escrow.ID)
		}
		var locked models.Order
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&locked, "id = ?", order.ID).Error; err != nil {
			return err
		}
		if locked.Status == models.OrderStatusCompleted {
			return nil
		}
		return fsm.TransitionOrder(tx, &locked, models.OrderStatusCompleted, "api.escrow.reaper_finalize", nil)
	})
}

// markEscrowDisputedTx conditionally moves held|releasing -> disputed
// inside the caller's tx. Returns false when the escrow already reached
// a terminal state (released/refunded): settlement committed first and
// the dispute must be rejected - this conditional update IS the
// dispute-vs-settle precedence rule (W-24). The unconditional Update it
// replaces could overwrite `released` after funds were paid.
func markEscrowDisputedTx(tx *gorm.DB, escrowID uuid.UUID) (bool, error) {
	res := tx.Model(&models.EscrowTransaction{}).
		Where("id = ? AND status IN ?", escrowID, []models.EscrowStatus{models.EscrowHeld, models.EscrowReleasing}).
		Update("status", models.EscrowDisputed)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected == 1, nil
}
