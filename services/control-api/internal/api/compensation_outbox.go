package api

import (
	"encoding/json"
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

// StartCompensationOutboxWorker retries failed withdraw/P2P compensating DB refunds
// and durable forward P2P settles (BE-10).
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
		Metadata:           "{}",
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

// p2pSettleMeta is stored in compensation_outbox.metadata for p2p_settle rows.
type p2pSettleMeta struct {
	SenderWallet      string `json:"sender_wallet"`
	RecipientWallet   string `json:"recipient_wallet"`
	SenderUserID      string `json:"sender_user_id"`
	RecipientUserID   string `json:"recipient_user_id"`
	SenderWalletID    string `json:"sender_wallet_id"`
	RecipientWalletID string `json:"recipient_wallet_id"`
}

// EnqueueP2PSettle records a durable forward on-chain settle after ledger commit (BE-10).
func EnqueueP2PSettle(amountSOL float64, ref string, senderUserID, recipientUserID, senderWalletID, recipientWalletID uuid.UUID, senderAddr, recipientAddr string) {
	if amountSOL <= 0 || ref == "" || senderAddr == "" || recipientAddr == "" {
		return
	}
	meta, _ := json.Marshal(p2pSettleMeta{
		SenderWallet:      senderAddr,
		RecipientWallet:   recipientAddr,
		SenderUserID:      senderUserID.String(),
		RecipientUserID:   recipientUserID.String(),
		SenderWalletID:    senderWalletID.String(),
		RecipientWalletID: recipientWalletID.String(),
	})
	cp := recipientUserID
	entry := models.CompensationOutbox{
		Kind:               models.CompensationKindP2PSettle,
		UserID:             senderUserID,
		CounterpartyUserID: &cp,
		AmountSOL:          amountSOL,
		ReferenceID:        ref,
		Metadata:           string(meta),
		Status:             models.CompensationStatusPending,
		NextRetryAt:        time.Now().UTC(),
	}
	if err := db.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "kind"}, {Name: "reference_id"}},
		DoNothing: true,
	}).Create(&entry).Error; err != nil {
		logging.Error(err).Str("reference_id", ref).Msg("p2p settle outbox: enqueue failed")
		alerts.Send(alerts.Critical, "P2P Settle Outbox Enqueue Failed",
			fmt.Sprintf("ref=%s sender=%s amount=%.9f err=%v", ref, senderUserID, amountSOL, err))
		return
	}
	logging.Info().
		Str("reference_id", ref).
		Float64("amount_sol", amountSOL).
		Msg("p2p settle outbox: enqueued")
}

// ApplyCompensationOutboxEntry applies one pending compensation. Safe to retry.
func ApplyCompensationOutboxEntry(entry *models.CompensationOutbox) error {
	switch entry.Kind {
	case models.CompensationKindWithdrawalRefund:
		return applyWithdrawalCompensation(entry)
	case models.CompensationKindP2PRefund:
		return applyP2PCompensation(entry)
	case models.CompensationKindP2PSettle:
		return applyP2PSettle(entry)
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
		if err := models.CreditWalletLocked(tx, &wallet, entry.AmountSOL, "withdrawal_failed_refund", entry.ReferenceID,
			"Compensating refund (outbox retry) — balance restored after on-chain withdraw failure"); err != nil {
			return err
		}
		_ = tx.Where("wallet_id = ? AND user_id = ? AND type = ? AND reference = ?",
			wallet.ID, entry.UserID, models.SpendingWithdraw, entry.ReferenceID).
			Delete(&models.SpendingRecord{}).Error
		return nil
	})
}

// applyP2PSettle runs the forward on-chain transfer for a durable outbox row (BE-10).
func applyP2PSettle(entry *models.CompensationOutbox) error {
	var meta p2pSettleMeta
	if err := json.Unmarshal([]byte(entry.Metadata), &meta); err != nil {
		return fmt.Errorf("p2p_settle metadata: %w", err)
	}
	if meta.SenderWallet == "" || meta.RecipientWallet == "" {
		return nil // custodial-only; nothing to settle on-chain
	}

	// Idempotent: already settled if ledger has tx_hash for this ref.
	var settled int64
	if err := db.DB.Model(&models.WalletLedgerEntry{}).
		Where("reference_id = ? AND type = ? AND tx_hash IS NOT NULL AND tx_hash <> ''", entry.ReferenceID, "p2p_sent").
		Count(&settled).Error; err != nil {
		return err
	}
	if settled > 0 {
		return nil
	}
	// Already refunded — do not re-send.
	var refunded int64
	if err := db.DB.Model(&models.WalletLedgerEntry{}).
		Where("reference_id = ? AND type = ?", entry.ReferenceID, "p2p_failed_refund").
		Count(&refunded).Error; err != nil {
		return err
	}
	if refunded > 0 {
		return nil
	}

	senderUID, err := uuid.Parse(meta.SenderUserID)
	if err != nil {
		return fmt.Errorf("sender_user_id: %w", err)
	}
	recipientUID, err := uuid.Parse(meta.RecipientUserID)
	if err != nil {
		return fmt.Errorf("recipient_user_id: %w", err)
	}
	senderWID, err := uuid.Parse(meta.SenderWalletID)
	if err != nil {
		return fmt.Errorf("sender_wallet_id: %w", err)
	}
	recipientWID, err := uuid.Parse(meta.RecipientWalletID)
	if err != nil {
		return fmt.Errorf("recipient_wallet_id: %w", err)
	}

	sw, rw := meta.SenderWallet, meta.RecipientWallet
	settleP2POnChain(&sw, &rw, entry.AmountSOL, senderUID, senderWID, recipientUID, recipientWID, entry.ReferenceID)
	return nil
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

		// Reverse P2P: skip per-leg treasury journals, then one balanced reverse journal
		// (same pattern as settleP2POnChain compensating path).
		skip := models.LedgerOpts{JournalKind: "skip"}
		senderDesc := "Compensating P2P refund (outbox retry) — sender restored"
		recipientDesc := "Compensating P2P debit (outbox retry) — recipient corrected"
		if err := models.CreditWalletLockedOpts(tx, senderWallet, entry.AmountSOL, "p2p_failed_refund",
			entry.ReferenceID, senderDesc, skip); err != nil {
			return err
		}
		if err := models.DebitWalletLockedOpts(tx, recipientWallet, entry.AmountSOL, "p2p_failed_debit",
			entry.ReferenceID, recipientDesc, skip); err != nil {
			return err
		}
		delta := int64(models.SOLToLamports(entry.AmountSOL))
		sID, rID := senderWallet.ID, recipientWallet.ID
		return models.PostBalancedJournal(tx, "p2p_failed_refund", entry.ReferenceID, senderDesc, []models.JournalLineSpec{
			{AccountCode: models.AccountUserWalletLiability, WalletID: &rID, AmountLamports: delta},
			{AccountCode: models.AccountUserWalletLiability, WalletID: &sID, AmountLamports: -delta},
		})
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
