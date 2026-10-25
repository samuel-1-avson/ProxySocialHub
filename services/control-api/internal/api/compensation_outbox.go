package api

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/alerts"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/orders/fsm"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
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

// escrowSettleMeta is stored in compensation_outbox.metadata for escrow_settle rows.
type escrowSettleMeta struct {
	OrderID         string `json:"order_id"`
	EscrowPDA       string `json:"escrow_pda"`
	BuyerWallet     string `json:"buyer_wallet"`
	SellerWallet    string `json:"seller_wallet"`
	BandwidthUsedGB uint64 `json:"bandwidth_used_gb"`
	UsedBytes       *int64 `json:"used_bytes,omitempty"`
	FullRelease     bool   `json:"full_release,omitempty"`
	Source          string `json:"source"`
}

// EnqueueEscrowSettle records a durable marketplace escrow SettleEscrow retry (M5 / 2.5).
func EnqueueEscrowSettle(order *models.Order, source string) {
	enqueueEscrowSettleMeta(order, source, escrowSettleMeta{FullRelease: true})
}

// EnqueueEscrowSettleUsage records settle retry with explicit on-chain used units.
func EnqueueEscrowSettleUsage(order *models.Order, source string, usedUnits uint64) {
	enqueueEscrowSettleMeta(order, source, escrowSettleMeta{BandwidthUsedGB: usedUnits})
}

// EnqueueEscrowSettleBytes records settle retry from consumed session bytes.
func EnqueueEscrowSettleBytes(order *models.Order, source string, usedBytes int64) {
	b := usedBytes
	enqueueEscrowSettleMeta(order, source, escrowSettleMeta{UsedBytes: &b})
}

func enqueueEscrowSettleMeta(order *models.Order, source string, extra escrowSettleMeta) {
	if order == nil || order.EscrowPDA == "" || order.BuyerWallet == "" || order.SellerWallet == "" {
		return
	}
	ref := "escrow_settle:" + order.ID.String()
	meta := extra
	meta.OrderID = order.ID.String()
	meta.EscrowPDA = order.EscrowPDA
	meta.BuyerWallet = order.BuyerWallet
	meta.SellerWallet = order.SellerWallet
	meta.Source = source
	if meta.FullRelease && meta.BandwidthUsedGB == 0 {
		meta.BandwidthUsedGB = solanaClient.LimitUnitsFromGiB(orderPurchasedGiB(order))
	}
	raw, _ := json.Marshal(meta)
	entry := models.CompensationOutbox{
		Kind:        models.CompensationKindEscrowSettle,
		UserID:      order.BuyerID,
		AmountSOL:   order.AmountLockedSOL,
		ReferenceID: ref,
		Metadata:    string(raw),
		Status:      models.CompensationStatusPending,
		NextRetryAt: time.Now().UTC(),
	}
	if err := db.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "kind"}, {Name: "reference_id"}},
		DoNothing: true,
	}).Create(&entry).Error; err != nil {
		logging.Error(err).Str("order_id", order.ID.String()).Msg("escrow settle outbox: enqueue failed")
		alerts.Send(alerts.Critical, "Escrow Settle Outbox Enqueue Failed",
			fmt.Sprintf("order=%s pda=%s err=%v", order.ID, order.EscrowPDA, err))
		return
	}
	usedBytes := int64(-1)
	if meta.UsedBytes != nil {
		usedBytes = *meta.UsedBytes
	}
	logging.Warn().
		Str("order_id", order.ID.String()).
		Str("escrow_pda", order.EscrowPDA).
		Str("source", source).
		Uint64("bandwidth_used_units", meta.BandwidthUsedGB).
		Int64("used_bytes", usedBytes).
		Bool("full_release", meta.FullRelease).
		Msg("escrow settle outbox: enqueued after on-chain settle failure")
}

// EnqueueEscrowRefund records EmergencyRefund retry for jury buyer-wins (W1.2).
func EnqueueEscrowRefund(order *models.Order, source, reason string) {
	if order == nil || order.EscrowPDA == "" || order.BuyerWallet == "" {
		return
	}
	ref := "escrow_refund:" + order.ID.String()
	meta, _ := json.Marshal(escrowSettleMeta{
		OrderID:     order.ID.String(),
		EscrowPDA:   order.EscrowPDA,
		BuyerWallet: order.BuyerWallet,
		SellerWallet: order.SellerWallet,
		Source:      source,
	})
	errMsg := reason
	entry := models.CompensationOutbox{
		Kind:        models.CompensationKindEscrowRefund,
		UserID:      order.BuyerID,
		AmountSOL:   order.AmountLockedSOL,
		ReferenceID: ref,
		Metadata:    string(meta),
		Status:      models.CompensationStatusPending,
		NextRetryAt: time.Now().UTC(),
		LastError:   &errMsg,
	}
	if err := db.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "kind"}, {Name: "reference_id"}},
		DoNothing: true,
	}).Create(&entry).Error; err != nil {
		logging.Error(err).Str("order_id", order.ID.String()).Msg("escrow refund outbox: enqueue failed")
		return
	}
	logging.Warn().
		Str("order_id", order.ID.String()).
		Str("escrow_pda", order.EscrowPDA).
		Str("source", source).
		Msg("escrow refund outbox: enqueued after jury buyer-wins on-chain failure")
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
	case models.CompensationKindEscrowSettle:
		return applyEscrowSettle(entry)
	case models.CompensationKindEscrowRefund:
		return applyEscrowRefund(entry)
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

// applyEscrowSettle retries marketplace SettleEscrow and completes the order on success.
func applyEscrowSettle(entry *models.CompensationOutbox) error {
	var meta escrowSettleMeta
	if err := json.Unmarshal([]byte(entry.Metadata), &meta); err != nil {
		return fmt.Errorf("escrow_settle metadata: %w", err)
	}
	orderID, err := uuid.Parse(meta.OrderID)
	if err != nil {
		return fmt.Errorf("order_id: %w", err)
	}
	var order models.Order
	if err := db.DB.First(&order, "id = ?", orderID).Error; err != nil {
		return err
	}
	if orderHasSettleTx(order) {
		return nil // already settled on-chain
	}

	if solanaClient.GetOracleClient() == nil {
		return fmt.Errorf("oracle client not available")
	}
	// Prefer live order wallets/PDA/seed kind (BC-06 multisig) over stale metadata.
	if order.EscrowPDA == "" {
		order.EscrowPDA = meta.EscrowPDA
	}
	if order.SellerWallet == "" {
		order.SellerWallet = meta.SellerWallet
	}
	if order.BuyerWallet == "" {
		order.BuyerWallet = meta.BuyerWallet
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	source := meta.Source
	if source == "" {
		source = "outbox.escrow_settle"
	}
	var settleTxHash string
	var txErr error
	switch {
	case meta.FullRelease:
		settleTxHash, txErr = SettleOrderEscrow(ctx, source, &order)
	case meta.UsedBytes != nil:
		settleTxHash, txErr = SettleOrderEscrowConsumedBytes(ctx, source, &order, *meta.UsedBytes)
	default:
		settleTxHash, txErr = SettleOrderEscrowUsage(ctx, source, &order, meta.BandwidthUsedGB)
	}
	if txErr != nil {
		return txErr
	}

	if order.Status == models.OrderStatusCompleted {
		_ = db.DB.Model(&order).Update("tx_hash", settleTxHash).Error
		finalizeProviderPayoutAfterSettle(&order, settleTxHash)
		return nil
	}
	if err := db.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&order, "id = ?", orderID).Error; err != nil {
			return err
		}
		if order.Status == models.OrderStatusCompleted {
			return tx.Model(&order).Update("tx_hash", settleTxHash).Error
		}
		return fsm.TransitionOrder(tx, &order, models.OrderStatusCompleted, "outbox.escrow_settle", map[string]interface{}{
			"tx_hash": settleTxHash,
		})
	}); err != nil {
		return err
	}
	finalizeProviderPayoutAfterSettle(&order, settleTxHash)
	return nil
}

func orderHasSettleTx(order models.Order) bool {
	return order.TxHash != ""
}

func finalizeProviderPayoutAfterSettle(order *models.Order, settleSig string) {
	if order == nil || order.SessionID == nil {
		return
	}
	var session models.Session
	if err := db.DB.First(&session, "id = ?", *order.SessionID).Error; err != nil {
		return
	}
	recordProviderEarning(session, session.BytesUsed, resolveSessionEarningPricePerGBSOL(session), 0)
	now := time.Now().UTC()
	_ = db.DB.Model(&models.ProviderEarning{}).
		Where("session_id = ? AND status = 'pending'", session.ID).
		Updates(map[string]interface{}{
			"status":  "paid",
			"tx_hash": settleSig,
			"paid_at": now,
		})
}

// applyEscrowRefund retries EmergencyRefund for jury buyer-wins (W1.2).
func applyEscrowRefund(entry *models.CompensationOutbox) error {
	var meta escrowSettleMeta
	if err := json.Unmarshal([]byte(entry.Metadata), &meta); err != nil {
		return fmt.Errorf("escrow_refund metadata: %w", err)
	}
	orderID, err := uuid.Parse(meta.OrderID)
	if err != nil {
		return fmt.Errorf("order_id: %w", err)
	}
	var order models.Order
	if err := db.DB.First(&order, "id = ?", orderID).Error; err != nil {
		return err
	}
	if order.Status == models.OrderStatusRefunded && order.TxSignature != "" {
		return nil
	}
	oracle := solanaClient.GetOracle()
	if oracle == nil {
		return fmt.Errorf("oracle client not available")
	}
	if order.EscrowPDA == "" {
		order.EscrowPDA = meta.EscrowPDA
	}
	if order.BuyerWallet == "" {
		order.BuyerWallet = meta.BuyerWallet
	}
	buyerPub, err := sol.PublicKeyFromBase58(order.BuyerWallet)
	if err != nil {
		return fmt.Errorf("buyer wallet: %w", err)
	}
	escrowPDA, err := sol.PublicKeyFromBase58(order.EscrowPDA)
	if err != nil {
		return fmt.Errorf("escrow pda: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	txHash, txErr := oracle.EmergencyRefund(ctx, solanaClient.RefundEscrowParams{
		Buyer:     buyerPub,
		EscrowPDA: escrowPDA,
	})
	if txErr != nil {
		return txErr
	}
	return db.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&order, "id = ?", orderID).Error; err != nil {
			return err
		}
		if order.Status == models.OrderStatusRefunded {
			return tx.Model(&order).Update("tx_signature", txHash).Error
		}
		return fsm.TransitionOrder(tx, &order, models.OrderStatusRefunded, "outbox.escrow_refund", map[string]interface{}{
			"tx_hash": txHash,
		})
	})
}

// applyP2PSettle retires a legacy p2p_settle row without sending anything.
// BE-CRIT-01: internal P2P transfers no longer settle on chain. Rows queued before
// that change must not be paid out of the treasury, so they are acknowledged and
// skipped (migration 000154 also cancels pending rows up front).
func applyP2PSettle(entry *models.CompensationOutbox) error {
	logging.Warn().
		Str("id", entry.ID.String()).
		Str("reference_id", entry.ReferenceID).
		Float64("amount_sol", entry.AmountSOL).
		Msg("compensation outbox: skipped legacy p2p_settle row (on-chain P2P settle removed)")
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

// outboxClaimLease is how long a claimed row stays invisible to other workers. If the
// process dies mid-apply the row becomes due again after this long; the appliers are
// idempotent, so a retry is safe.
const outboxClaimLease = 5 * time.Minute

// claimDueOutboxEntries selects due pending rows with FOR UPDATE SKIP LOCKED and pushes
// their next_retry_at out by the lease before returning them, all in one transaction. Two
// pods running the outbox worker at once therefore never apply the same row (before this
// both read the same rows and could settle or refund one escrow twice).
func claimDueOutboxEntries(limit int, now time.Time) ([]models.CompensationOutbox, error) {
	var entries []models.CompensationOutbox
	err := db.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("status = ? AND next_retry_at <= ?", models.CompensationStatusPending, now).
			Order("next_retry_at ASC").
			Limit(limit).
			Find(&entries).Error; err != nil {
			return err
		}
		if len(entries) == 0 {
			return nil
		}
		ids := make([]uuid.UUID, len(entries))
		for i := range entries {
			ids[i] = entries[i].ID
		}
		return tx.Model(&models.CompensationOutbox{}).
			Where("id IN ?", ids).
			Update("next_retry_at", now.Add(outboxClaimLease)).Error
	})
	return entries, err
}

// ProcessCompensationOutboxOnce claims due pending rows and applies them.
func ProcessCompensationOutboxOnce(limit int) (succeeded, failed, permanent int) {
	if limit <= 0 {
		limit = 50
	}
	now := time.Now().UTC()
	entries, err := claimDueOutboxEntries(limit, now)
	if err != nil {
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
