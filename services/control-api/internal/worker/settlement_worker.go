package worker

import (
	"context"
	"log"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
)

type SettlementAggregator struct {
	oracle   *solana.OracleClient
	interval time.Duration
}

func NewSettlementAggregator(oracle *solana.OracleClient, interval time.Duration) *SettlementAggregator {
	return &SettlementAggregator{
		oracle:   oracle,
		interval: interval,
	}
}

// Start initiates the background settlement loop
func (w *SettlementAggregator) Start(ctx context.Context) {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	log.Printf("[SettlementWorker] Started automated batch settlement (Interval: %v)", w.interval)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.runBatchSettlement(ctx)
		}
	}
}

func (w *SettlementAggregator) runBatchSettlement(ctx context.Context) {
	// 1. Fetch completed orders with active escrows that aren't settled yet
	// We'll look for orders in 'completed' status where the escrow is still 'held'
	var escrows []models.EscrowTransaction
	err := db.DB.Preload("Order").
		Joins("JOIN orders ON orders.id = escrow_transactions.order_id").
		Where("orders.status = ? AND escrow_transactions.status = ?", models.OrderStatusCompleted, models.EscrowHeld).
		Limit(20). // Solana transaction limit for instructions
		Find(&escrows).Error

	if err != nil {
		log.Printf("[SettlementWorker] Failed to fetch pending escrows: %v", err)
		return
	}

	if len(escrows) == 0 {
		return
	}

	log.Printf("[SettlementWorker] Found %d escrows ready for batch settlement", len(escrows))

	// 2. Prepare Batch Parameters
	var batch []solana.SettleEscrowParams
	for _, e := range escrows {
		escrowPubKey, err := sol.PublicKeyFromBase58(e.Order.EscrowPDA)
		if err != nil {
			log.Printf("[SettlementWorker] Invalid EscrowPDA %s for Order %s", e.Order.EscrowPDA, e.OrderID)
			continue
		}

		batch = append(batch, solana.SettleEscrowParams{
			EscrowPDA: escrowPubKey,
		})
	}

	if len(batch) == 0 {
		return
	}

	// 3. Execute Batch Settle
	sig, err := w.oracle.BatchSettleEscrows(ctx, batch)
	if err != nil {
		log.Printf("[SettlementWorker] Batch settlement failed: %v", err)
		return
	}

	log.Printf("[SettlementWorker] Batch settled successfully! Sig: %s", sig)

	// 4. Update Database Status
	now := time.Now()
	for _, e := range escrows {
		db.DB.Model(&e).Updates(map[string]interface{}{
			"status":      models.EscrowReleased,
			"released_at": &now,
		})

		// Also update order status if needed (though it's already 'completed')
		db.DB.Model(&e.Order).Update("tx_hash", sig)
	}
}
