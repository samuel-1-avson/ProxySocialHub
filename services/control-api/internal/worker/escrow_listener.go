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
			log.Printf("[Worker] EscrowInit PDA %s: order not found (attempt %d/%d), retrying in %s…",
				event.EscrowPDA, attempt, maxAttempts, retryDelay)
			time.Sleep(retryDelay)
		}
	}

	if !found {
		logging.Error(fmt.Errorf("escrow init event lost after %d attempts", maxAttempts)).
			Str("escrow_pda", event.EscrowPDA).
			Str("tx_signature", event.TxSignature).
			Msg("CRITICAL: escrow initialized on-chain but no matching order found — manual reconciliation required")
		return
	}

	if err := models.ValidateOrderStatusTransition(order.Status, models.OrderStatusActive); err != nil {
		logging.Warn().Err(err).Str("order_id", order.ID.String()).Msg("Ignoring escrow initialized event for non-activatable order")
		return
	}
	db.DB.Model(&order).Updates(map[string]interface{}{
		"status":       models.OrderStatusActive,
		"tx_signature": event.TxSignature,
		"updated_at":   time.Now(),
	})
	if err := marketplace.ActivateOrderSession(context.Background(), order.ID); err != nil {
		logging.Error(err).
			Str("order_id", order.ID.String()).
			Msg("Order activated on-chain but session activation failed")
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
}

func handleEscrowSettled(event solana.EscrowEvent) {
	var order models.Order
	if err := db.DB.Where("escrow_pda = ?", event.EscrowPDA).First(&order).Error; err == nil {
		if err := models.ValidateOrderStatusTransition(order.Status, models.OrderStatusCompleted); err != nil {
			logging.Warn().Err(err).Str("order_id", order.ID.String()).Msg("Ignoring escrow settled event for non-completable order")
			return
		}
		db.DB.Model(&order).Updates(map[string]interface{}{
			"status":     models.OrderStatusCompleted,
			"updated_at": time.Now(),
		})
		logging.Info().
			Str("order_id", order.ID.String()).
			Msg("Order completed via Solana Settlement")
	}
}

var treasuryAddress = os.Getenv("SOLANA_TREASURY_ADDRESS")

func handleNativeDeposit(event solana.EscrowEvent) {
	// 0. Verify deposit was sent TO the platform treasury
	// For native_deposit events, Seller is set to the treasury address by the watcher.
	if treasuryAddress != "" && event.Seller != treasuryAddress {
		logging.Warn().
			Str("sender", event.Buyer).
			Str("recipient", event.Seller).
			Str("expected_treasury", treasuryAddress).
			Msg("Auto-Deposit ignored: recipient is not platform treasury")
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
	wallet.BalanceSOL += solAmount
	if err := tx.Save(&wallet).Error; err != nil {
		tx.Rollback()
		log.Printf("[Worker] Auto-Deposit: Failed to credit user %s: %v", userID, err)
		return
	}

	// Log Transaction
	pendingTx := models.PendingTransaction{
		ID:             uuid.New(),
		UserID:         userID,
		Reference:      event.TxSignature,
		IdempotencyKey: event.TxSignature,
		Type:           "crypto_deposit",
		Amount:         solAmount,
		Currency:       "SOL",
		Provider:       "blockchain_auto",
		Status:         "completed",
		ExternalRef:    event.TxSignature,
	}
	tx.Create(&pendingTx)

	ledger := models.WalletLedgerEntry{
		ID:           uuid.New(),
		WalletID:     wallet.ID,
		Amount:       solAmount,
		BalanceAfter: wallet.BalanceSOL,
		Type:         "deposit_auto",
		ReferenceID:  event.TxSignature,
		Description:  fmt.Sprintf("Auto-Deposit: %.6f SOL", solAmount),
	}
	tx.Create(&ledger)

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
