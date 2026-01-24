package worker

import (
	"log"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
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
