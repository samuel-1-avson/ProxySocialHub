package worker

import (
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
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
		log.Println("[Worker] Solana watcher not initialized, skipping escrow listener")
		return
	}

	watcher.OnEvent(func(event solana.EscrowEvent) {
		log.Printf("[Worker] Processing Escrow Event: %s (PDA: %s)", event.Type, event.EscrowPDA)

		if event.Type == "initialized" {
			handleEscrowInitialized(event)
		} else if event.Type == "settled" {
			handleEscrowSettled(event)
		} else if event.Type == "native_deposit" {
			handleNativeDeposit(event)
		}
	})
}

func handleEscrowInitialized(event solana.EscrowEvent) {
	// Find order by PDA matches
	var order models.Order
	if err := db.DB.Where("escrow_pda = ?", event.EscrowPDA).First(&order).Error; err != nil {
		log.Printf("[Worker] Waiting for Order creation for PDA %s (might be race condition)", event.EscrowPDA)
		// Retry/Wait logic could go here, or assume Order was created via API *before* user sent TX.
		// API `initiateSolanaPayment` sets `escrow_pda`.
		return
	}

	if order.Status == models.OrderStatusPending {
		db.DB.Model(&order).Updates(map[string]interface{}{
			"status":       models.OrderStatusActive,
			"tx_signature": event.TxSignature,
			"updated_at":   time.Now(),
		})
		log.Printf("[Worker] Order %s activated via Solana Escrow (Tx: %s)", order.ID, event.TxSignature)
	}
}

func handleEscrowSettled(event solana.EscrowEvent) {
	var order models.Order
	if err := db.DB.Where("escrow_pda = ?", event.EscrowPDA).First(&order).Error; err == nil {
		db.DB.Model(&order).Updates(map[string]interface{}{
			"status":     models.OrderStatusCompleted,
			"updated_at": time.Now(),
		})
		log.Printf("[Worker] Order %s completed via Solana Settlement", order.ID)
	}
}

func handleNativeDeposit(event solana.EscrowEvent) {
	// 1. Find user by linked wallet address (Global Search)
	var userID uuid.UUID

	// Check LinkedWallets table first (Primary source)
	var linkedWallet models.LinkedWallet
	if err := db.DB.Where("address = ?", event.Buyer).First(&linkedWallet).Error; err == nil {
		userID = linkedWallet.UserID
		log.Printf("[Worker] Auto-Deposit: Found user %s via linked_wallets for address %s", userID, event.Buyer)
	} else {
		// Fallback: Check primary profile field (Legacy/Initial)
		var user models.User
		if err := db.DB.Where("wallet_address = ?", event.Buyer).First(&user).Error; err == nil {
			userID = user.ID
			log.Printf("[Worker] Auto-Deposit: Found user %s via profile field for address %s", userID, event.Buyer)
		} else {
			log.Printf("[Worker] Auto-Deposit: No linked user found for wallet %s. Skipping auto-credit.", event.Buyer)
			return
		}
	}

	log.Printf("[Worker] Auto-Deposit: Identified user %s for wallet %s. Crediting %.6f SOL...", userID, event.Buyer, float64(event.Amount)/1e9)

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
			wallet = models.Wallet{UserID: userID, Currency: "MULTI"}
			tx.Create(&wallet)
		} else {
			tx.Rollback()
			log.Printf("[Worker] Auto-Deposit: Failed to retrieve or create wallet for user %s: %v", userID, err)
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
		ID:          uuid.New(),
		UserID:      userID.String(),
		Reference:   event.TxSignature,
		Type:        "crypto_deposit",
		Amount:      solAmount,
		Currency:    "SOL",
		Provider:    "blockchain_auto",
		Status:      "completed",
		ExternalRef: event.TxSignature,
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
		logging.Error(err).Msg("Failed to commit auto-deposit")
		return
	}

	log.Printf("[Worker] Auto-Deposit SUCCESS: Credited %.6f SOL to user %s (Ref: %s)", solAmount, userID, event.TxSignature)

	// Emit WebSocket notification via NATS for real-time UI balance update
	ws.BroadcastToUser(userID.String(), ws.MsgTypeWalletUpdate, map[string]interface{}{
		"type":        "deposit",
		"amount":      solAmount,
		"currency":    "SOL",
		"new_balance": wallet.BalanceSOL,
		"timestamp":   time.Now().UnixMilli(),
	})
}
