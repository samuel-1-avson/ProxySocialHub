package worker

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	internalNats "github.com/proxyhubb/control-api/internal/nats"
	"github.com/proxyhubb/control-api/internal/solana"
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
	// 1. Find user by linked wallet address
	var user models.User
	if err := db.DB.Where("wallet_address = ?", event.Buyer).First(&user).Error; err != nil {
		log.Printf("[Worker] Auto-Deposit: No linked user found for wallet %s. Skipping auto-credit.", event.Buyer)
		return
	}

	log.Printf("[Worker] Auto-Deposit: Identified user %s for wallet %s. Crediting %.6f SOL...", user.ID, event.Buyer, float64(event.Amount)/1e9)

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
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			wallet = models.Wallet{UserID: user.ID, Currency: "MULTI"}
			tx.Create(&wallet)
		} else {
			tx.Rollback()
			return
		}
	}

	amountSOL := float64(event.Amount) / 1e9
	wallet.BalanceSOL += amountSOL
	if err := tx.Save(&wallet).Error; err != nil {
		tx.Rollback()
		return
	}

	// Log Transaction
	pendingTx := models.PendingTransaction{
		ID:          uuid.New(),
		UserID:      user.ID.String(),
		Reference:   event.TxSignature,
		Type:        "crypto_deposit",
		Amount:      amountSOL,
		Currency:    "SOL",
		Provider:    "blockchain_auto",
		Status:      "completed",
		ExternalRef: event.TxSignature,
	}
	tx.Create(&pendingTx)

	ledger := models.WalletLedgerEntry{
		ID:           uuid.New(),
		WalletID:     wallet.ID,
		Amount:       amountSOL,
		BalanceAfter: wallet.BalanceSOL,
		Type:         "deposit_auto",
		ReferenceID:  event.TxSignature,
		Description:  fmt.Sprintf("Auto-Deposit: %.6f SOL", amountSOL),
	}
	tx.Create(&ledger)

	if err := tx.Commit().Error; err != nil {
		logging.Error(err).Msg("Failed to commit auto-deposit")
		return
	}

	log.Printf("[Worker] Auto-Deposit SUCCESS: Credited %.6f SOL to user %s", amountSOL, user.ID)

	// Emit WebSocket notification via NATS for real-time UI balance update
	subject := fmt.Sprintf("proxy.wallet.v1.update.%s", user.ID.String())
	internalNats.Publish(context.Background(), subject, map[string]interface{}{
		"type":        "deposit",
		"amount":      amountSOL,
		"currency":    "SOL",
		"new_balance": wallet.BalanceSOL,
		"timestamp":   time.Now(),
	})
}
