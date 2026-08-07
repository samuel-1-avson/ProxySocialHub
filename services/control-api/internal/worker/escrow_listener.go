package worker

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/audit"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/marketplace/funnel"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/orders/fsm"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/ws"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// RegisterEscrowEventListener subscribes to blockchain events to update order status
func RegisterEscrowEventListener() {
	watcher := solana.GetWatcher()
	if watcher == nil {
		logging.Info().Msg("Solana watcher not initialized, skipping escrow listener")
		return
	}

	watcher.OnEvent(func(event solana.EscrowEvent) {
		logging.Info().
			Str("event_type", event.Type).
			Str("escrow_pda", event.EscrowPDA).
			Msg("Processing escrow event")

		if event.Type == "initialized" {
			handleEscrowInitialized(event)
		} else if event.Type == "settled" {
			handleEscrowSettled(event)
		} else if event.Type == "native_deposit" {
			handleNativeDeposit(event)
		}
	})
}

// handleEscrowInitialized activates the order linked to the on-chain escrow PDA.
// P1-22: If the order row is not found (race: event arrived before the API
// committed the order), retry up to 12 times with 5-second intervals (60s
// total) before giving up and logging a critical alert.
func handleEscrowInitialized(event solana.EscrowEvent) {
	const (
		maxAttempts = 12
		retryDelay  = 5 * time.Second
	)

	var order models.Order
	var found bool

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if err := db.DB.Where("escrow_pda = ?", event.EscrowPDA).First(&order).Error; err == nil {
			found = true
			break
		}
		if attempt < maxAttempts {
			log.Printf("[Worker] EscrowInit PDA %s: order not found (attempt %d/%d), retrying in %sÃ¢â‚¬Â¦",
				event.EscrowPDA, attempt, maxAttempts, retryDelay)
			time.Sleep(retryDelay)
		}
	}

	if !found {
		logging.Error(fmt.Errorf("escrow init event lost after %d attempts", maxAttempts)).
			Str("escrow_pda", event.EscrowPDA).
			Str("tx_signature", event.TxSignature).
			Msg("CRITICAL: escrow initialized on-chain but no matching order found Ã¢â‚¬â€ manual reconciliation required")
		recordEscrowReconciliation(escrowReconciliationRecord{
			Source:      "escrow_listener",
			EventType:   event.Type,
			EscrowPDA:   event.EscrowPDA,
			TxSignature: event.TxSignature,
			Status:      models.EscrowReconciliationStatusUnmatched,
			Reason:      "order_not_found",
			LastError:   fmt.Sprintf("order not found after %d attempts", maxAttempts),
			Payload:     event,
		})
		return
	}

	if err := fsm.TransitionOrder(db.DB, &order, models.OrderStatusActive, "worker.escrow_listener.init", map[string]interface{}{
		"tx_signature": event.TxSignature,
	}); err != nil {
		logging.Warn().Err(err).Str("order_id", order.ID.String()).Msg("Ignoring escrow initialized event for non-activatable order")
		recordEscrowReconciliation(escrowReconciliationRecord{
			Source:      "escrow_listener",
			EventType:   event.Type,
			EscrowPDA:   event.EscrowPDA,
			TxSignature: event.TxSignature,
			OrderID:     &order.ID,
			Status:      models.EscrowReconciliationStatusInvalidState,
			Reason:      "invalid_order_transition",
			LastError:   err.Error(),
			Payload:     event,
		})
		return
	}
	if err := marketplace.ActivateOrderSession(context.Background(), order.ID); err != nil {
		logging.Error(err).
			Str("order_id", order.ID.String()).
			Msg("Order active but session sync failed; scheduling immediate retry (retry worker is also active)")
		orderID := order.ID
		go func() {
			time.Sleep(2 * time.Second)
			if retryErr := marketplace.ActivateOrderSession(context.Background(), orderID); retryErr != nil {
				logging.Warn().Err(retryErr).
					Str("order_id", orderID.String()).
					Msg("Immediate session activation retry failed; background worker will continue")
			}
		}()
	}
	funnel.Record(context.Background(), funnel.RecordParams{
		EventName: models.FunnelEscrowConfirmed,
		UserID:    &order.BuyerID,
		ListingID: &order.ListingID,
		OrderID:   &order.ID,
		Surface:   "escrow_worker",
		Meta: map[string]interface{}{
			"tx_signature": event.TxSignature,
		},
	})

	logging.Info().
		Str("order_id", order.ID.String()).
		Str("tx_signature", event.TxSignature).
		Msg("Order activated via Solana Escrow")
	markEscrowReconciliationResolved(event.EscrowPDA, event.TxSignature, order.ID, "order_activated")
}

func handleEscrowSettled(event solana.EscrowEvent) {
	var order models.Order
	if err := db.DB.Where("escrow_pda = ?", event.EscrowPDA).First(&order).Error; err == nil {
		if err := fsm.TransitionOrder(db.DB, &order, models.OrderStatusCompleted, "worker.escrow_listener.settled", nil); err != nil {
			logging.Warn().Err(err).Str("order_id", order.ID.String()).Msg("Ignoring escrow settled event for non-completable order")
			recordEscrowReconciliation(escrowReconciliationRecord{
				Source:      "escrow_listener",
				EventType:   event.Type,
				EscrowPDA:   event.EscrowPDA,
				TxSignature: event.TxSignature,
				OrderID:     &order.ID,
				Status:      models.EscrowReconciliationStatusInvalidState,
				Reason:      "invalid_order_transition",
				LastError:   err.Error(),
				Payload:     event,
			})
			return
		}
		logging.Info().
			Str("order_id", order.ID.String()).
			Msg("Order completed via Solana Settlement")
		markEscrowReconciliationResolved(event.EscrowPDA, event.TxSignature, order.ID, "order_completed")
		return
	}
	recordEscrowReconciliation(escrowReconciliationRecord{
		Source:      "escrow_listener",
		EventType:   event.Type,
		EscrowPDA:   event.EscrowPDA,
		TxSignature: event.TxSignature,
		Status:      models.EscrowReconciliationStatusUnmatched,
		Reason:      "settled_order_not_found",
		LastError:   "settled event has no matching order",
		Payload:     event,
	})
}

var treasuryAddress = os.Getenv("SOLANA_TREASURY_ADDRESS")

func handleNativeDeposit(event solana.EscrowEvent) {
	// 0. Verify deposit was sent to an allowed destination (legacy treasury and/or vault).
	destKind := solana.ResolveDepositDestination(event.Seller)
	if destKind == "" {
		logging.Warn().
			Str("sender", event.Buyer).
			Str("recipient", event.Seller).
			Str("legacy_treasury", treasuryAddress).
			Str("vault", solana.GetDepositVaultAddress()).
			Msg("Auto-Deposit ignored: recipient is not an allowed deposit destination")
		return
	}

	// 1. Find user by linked wallet address (Global Search)
	var userID uuid.UUID

	// Check LinkedWallets table first (Primary source)
	var linkedWallet models.LinkedWallet
	if err := db.DB.Where("address = ?", event.Buyer).First(&linkedWallet).Error; err == nil {
		userID = linkedWallet.UserID
		logging.Info().
			Str("user_id", userID.String()).
			Str("wallet_address", event.Buyer).
			Msg("Auto-Deposit: found user via linked_wallets")
	} else {
		// Fallback: Check primary profile field (Legacy/Initial)
		var user models.User
		if err := db.DB.Where("wallet_address = ?", event.Buyer).First(&user).Error; err == nil {
			userID = user.ID
			logging.Info().
				Str("user_id", userID.String()).
				Str("wallet_address", event.Buyer).
				Msg("Auto-Deposit: found user via profile field")
		} else {
			logging.Warn().
				Str("wallet_address", event.Buyer).
				Msg("Auto-Deposit: no linked user found, skipping")
			return
		}
	}

	logging.Info().
		Str("user_id", userID.String()).
		Str("wallet_address", event.Buyer).
		Float64("amount_sol", float64(event.Amount)/1e9).
		Msg("Auto-Deposit: identified user, crediting SOL")

	// 2. Prevent Double Spending
	var existingTx models.PendingTransaction
	if err := db.DB.Where("reference = ?", event.TxSignature).First(&existingTx).Error; err == nil {
		log.Printf("[Worker] Auto-Deposit: Transaction %s already processed. Skipping.", event.TxSignature)
		return
	}

	// 3. Atomically Credit Wallet & Record
	tx := db.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var wallet models.Wallet
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).First(&wallet).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			wallet = models.Wallet{UserID: userID}
			tx.Create(&wallet)
		} else {
			tx.Rollback()
			logging.Error(err).
				Str("user_id", userID.String()).
				Msg("Auto-Deposit: failed to retrieve or create wallet")
			return
		}
	}

	solAmount := float64(event.Amount) / 1e9
	maxSingle := models.MaxSingleDepositSOL()
	if solAmount > maxSingle {
		tx.Rollback()
		logging.Warn().
			Str("user_id", userID.String()).
			Str("tx_signature", event.TxSignature).
			Float64("amount_sol", solAmount).
			Float64("max_sol", maxSingle).
			Msg("Auto-Deposit skipped: exceeds single deposit cap")
		return
	}
	maxDaily := models.MaxDailyDepositSOL()
	depositedToday, depErr := models.SumDepositsSince(tx, wallet.ID, time.Now().UTC().Add(-24*time.Hour))
	if depErr != nil {
		tx.Rollback()
		logging.Error(depErr).
			Str("user_id", userID.String()).
			Msg("Auto-Deposit: failed to check daily deposit limit")
		return
	}
	if depositedToday+solAmount > maxDaily {
		tx.Rollback()
		logging.Warn().
			Str("user_id", userID.String()).
			Str("tx_signature", event.TxSignature).
			Float64("amount_sol", solAmount).
			Float64("used_sol", depositedToday).
			Float64("max_sol", maxDaily).
			Msg("Auto-Deposit skipped: exceeds daily deposit cap")
		return
	}
	if err := models.CreditWalletLockedOpts(tx, &wallet, solAmount, "deposit_auto", event.TxSignature,
		fmt.Sprintf("Auto-Deposit: %.6f SOL", solAmount),
		models.LedgerOpts{
			TxHash:      event.TxSignature,
			JournalKind: solana.JournalKindForDeposit(destKind),
		},
	); err != nil {
		tx.Rollback()
		log.Printf("[Worker] Auto-Deposit: Failed to credit user %s: %v", userID, err)
		return
	}

	// Log Transaction
	pendingTx := models.PendingTransaction{
		ID:              uuid.New(),
		UserID:          userID,
		Reference:       event.TxSignature,
		IdempotencyKey:  event.TxSignature,
		Type:            "crypto_deposit",
		Amount:          solAmount,
		Currency:        "SOL",
		Provider:        "blockchain_auto",
		Status:          "completed",
		ExternalRef:     event.TxSignature,
		DestinationKind: string(destKind),
	}
	tx.Create(&pendingTx)

	if err := tx.Commit().Error; err != nil {
		logging.Error(err).
			Str("user_id", userID.String()).
			Str("tx_signature", event.TxSignature).
			Float64("amount_sol", solAmount).
			Msg("CRITICAL: Failed to commit auto-deposit")
		return
	}

	logging.Info().
		Float64("amount_sol", solAmount).
		Str("user_id", userID.String()).
		Str("tx_signature", event.TxSignature).
		Msg("Auto-Deposit: credited SOL successfully")

	// P2-13: Financial audit trail.
	audit.LogDirect(&userID, "", models.AuditFinancialAutoDeposit, "wallet", wallet.ID.String(),
		fmt.Sprintf("Auto-deposit %.6f SOL credited (tx: %s)", solAmount, event.TxSignature),
		map[string]interface{}{
			"amount_sol":   solAmount,
			"tx_signature": event.TxSignature,
			"from_address": event.Buyer,
		})

	// Emit WebSocket notification via NATS for real-time UI balance update
	ws.BroadcastToUser(userID.String(), ws.MsgTypeWalletUpdate, map[string]interface{}{
		"type":        "deposit",
		"amount":      solAmount,
		"currency":    "SOL",
		"new_balance": wallet.BalanceSOL,
		"timestamp":   time.Now().UnixMilli(),
	})
}
