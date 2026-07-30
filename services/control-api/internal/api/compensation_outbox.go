package api

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/alerts"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// StartCompensationOutboxWorker retries failed withdraw/P2P compensating DB refunds.
func StartCompensationOutboxWorker() {
	go func() {
		ticker := time.NewTicker(2 * time.Minute)
		defer ticker.Stop()
		ProcessCompensationOutboxOnce(50)
		for range ticker.C {
			ProcessCompensationOutboxOnce(50)
		}
	}()
}

// EnqueueCompensation records a pending compensating refund for the retry worker.
// Idempotent on (kind, reference_id).
func EnqueueCompensation(kind string, userID uuid.UUID, counterparty *uuid.UUID, amountSOL float64, referenceID, reason string) {
	if amountSOL <= 0 || referenceID == "" || kind == "" {
		return
	}
	entry := models.CompensationOutbox{
		Kind:               kind,
		UserID:             userID,
		CounterpartyUserID: counterparty,
		AmountSOL:          amountSOL,
		ReferenceID:        referenceID,
		Status:             models.CompensationStatusPending,
		NextRetryAt:        time.Now().UTC(),
		LastError:          &reason,
	}
	if err := db.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "kind"}, {Name: "reference_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"last_error", "updated_at", "next_retry_at"}),
	}).Create(&entry).Error; err != nil {
		logging.Error(err).
			Str("kind", kind).
			Str("reference_id", referenceID).
			Msg("compensation outbox: enqueue failed")
		alerts.Send(alerts.Critical, "Compensation Outbox Enqueue Failed",
			fmt.Sprintf("kind=%s ref=%s user=%s amount=%.9f err=%v", kind, referenceID, userID, amountSOL, err))
		return
	}
	logging.Warn().
		Str("kind", kind).
		Str("user_id", userID.String()).
		Str("reference_id", referenceID).
		Float64("amount_sol", amountSOL).
		Str("reason", reason).
		Msg("compensation outbox: enqueued after failed inline refund")
}

// ApplyCompensationOutboxEntry applies one pending compensation. Safe to retry.
func ApplyCompensationOutboxEntry(entry *models.CompensationOutbox) error {
	switch entry.Kind {
	case models.CompensationKindWithdrawalRefund:
		return applyWithdrawalCompensation(entry)
	case models.CompensationKindP2PRefund:
		return applyP2PCompensation(entry)
	default:
		return fmt.Errorf("unknown compensation kind %q", entry.Kind)
	}
}

func applyWithdrawalCompensation(entry *models.CompensationOutbox) error {
	return db.DB.Transaction(func(tx *gorm.DB) error {
		var existing int64
		if err := tx.Model(&models.WalletLedgerEntry{}).
			Where("reference_id = ? AND type = ?", entry.ReferenceID, "withdrawal_failed_refund").
			Count(&existing).Error; err != nil {
			return err
		}
		if existing > 0 {
			return nil // already applied
		}

		var wallet models.Wallet
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("user_id = ?", entry.UserID).First(&wallet).Error; err != nil {
			return err
		}
		wallet.CreditSOL(entry.AmountSOL)
		if err := tx.Save(&wallet).Error; err != nil {
			return err
		}
		_ = tx.Where("wallet_id = ? AND user_id = ? AND type = ? AND reference = ?",
			wallet.ID, entry.UserID, models.SpendingWithdraw, entry.ReferenceID).
			Delete(&models.SpendingRecord{}).Error

		return tx.Create(&models.WalletLedgerEntry{
			WalletID:     wallet.ID,
			Amount:       entry.AmountSOL,
			BalanceAfter: wallet.BalanceSOL,
			Type:         "withdrawal_failed_refund",
			ReferenceID:  entry.ReferenceID,
			Description:  "Compensating refund (outbox retry) — balance restored after on-chain withdraw failure",
			CreatedAt:    time.Now().UTC(),
		}).Error
	})
}

func applyP2PCompensation(entry *models.CompensationOutbox) error {
	if entry.CounterpartyUserID == nil {
		return fmt.Errorf("p2p compensation missing counterparty")
	}
	senderID := entry.UserID
	recipientID := *entry.CounterpartyUserID

	return db.DB.Transaction(func(tx *gorm.DB) error {
		var existing int64
		if err := tx.Model(&models.WalletLedgerEntry{}).
			Where("reference_id = ? AND type = ?", entry.ReferenceID, "p2p_failed_refund").
			Count(&existing).Error; err != nil {
			return err
		}
		if existing > 0 {
			return nil
		}

		var firstID, secondID uuid.UUID
		if senderID.String() < recipientID.String() {
			firstID, secondID = senderID, recipientID
		} else {
			firstID, secondID = recipientID, senderID
		}

		var first, second models.Wallet
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", firstID).First(&first).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", secondID).First(&second).Error; err != nil {
			return err
		}

		var senderWallet, recipientWallet *models.Wallet
		if firstID == senderID {
			senderWallet, recipientWallet = &first, &second
		} else {
			senderWallet, recipientWallet = &second, &first
		}

		senderWallet.CreditSOL(entry.AmountSOL)
		if !recipientWallet.DebitSOL(entry.AmountSOL) {
			return fmt.Errorf("recipient balance too low to reverse P2P credit")
		}
		if err := tx.Save(senderWallet).Error; err != nil {
			return err
		}
		if err := tx.Save(recipientWallet).Error; err != nil {
			return err
		}
		if err := tx.Create(&models.WalletLedgerEntry{
			WalletID:     senderWallet.ID,
			Amount:       entry.AmountSOL,
			BalanceAfter: senderWallet.BalanceSOL,
			Type:         "p2p_failed_refund",
			ReferenceID:  entry.ReferenceID,
			Description:  "Compensating P2P refund (outbox retry) — sender restored",
			CreatedAt:    time.Now().UTC(),
		}).Error; err != nil {
			return err
		}
		return tx.Create(&models.WalletLedgerEntry{
			WalletID:     recipientWallet.ID,
			Amount:       -entry.AmountSOL,
			BalanceAfter: recipientWallet.BalanceSOL,
			Type:         "p2p_failed_debit",
			ReferenceID:  entry.ReferenceID,
			Description:  "Compensating P2P debit (outbox retry) — recipient corrected",
			CreatedAt:    time.Now().UTC(),
		}).Error
	})
}

// ProcessCompensationOutboxOnce claims due pending rows and applies them.
func ProcessCompensationOutboxOnce(limit int) (succeeded, failed, permanent int) {
	if limit <= 0 {
		limit = 50
	}
	now := time.Now().UTC()
	var entries []models.CompensationOutbox
	if err := db.DB.
		Where("status = ? AND next_retry_at <= ?", models.CompensationStatusPending, now).
		Order("next_retry_at ASC").
		Limit(limit).
		Find(&entries).Error; err != nil {
		logging.Error(err).Msg("compensation outbox: query failed")
		return 0, 0, 0
	}

	for i := range entries {
		entry := &entries[i]
		applyErr := ApplyCompensationOutboxEntry(entry)
		attempt := entry.AttemptCount + 1
		updates := map[string]interface{}{
			"attempt_count":     attempt,
			"last_attempted_at": now,
			"updated_at":        now,
		}
		if applyErr == nil {
			updates["status"] = models.CompensationStatusSucceeded
			updates["last_error"] = nil
			succeeded++
			logging.Info().
				Str("id", entry.ID.String()).
				Str("kind", entry.Kind).
				Str("reference_id", entry.ReferenceID).
				Msg("compensation outbox: applied")
		} else {
			errMsg := applyErr.Error()
			updates["last_error"] = errMsg
			if attempt >= 8 {
				updates["status"] = models.CompensationStatusFailedPermanent
				permanent++
				alerts.Send(alerts.Critical, "Compensation Outbox Permanent Failure",
					fmt.Sprintf("id=%s kind=%s ref=%s attempts=%d err=%s", entry.ID, entry.Kind, entry.ReferenceID, attempt, errMsg))
			} else {
				backoffMins := 1 << attempt
				if backoffMins > 128 {
					backoffMins = 128
				}
				updates["next_retry_at"] = now.Add(time.Duration(backoffMins) * time.Minute)
				failed++
			}
		}
		if dbErr := db.DB.Model(&models.CompensationOutbox{}).Where("id = ?", entry.ID).Updates(updates).Error; dbErr != nil {
			logging.Error(dbErr).Str("id", entry.ID.String()).Msg("compensation outbox: status update failed")
		}
	}
	return succeeded, failed, permanent
}
