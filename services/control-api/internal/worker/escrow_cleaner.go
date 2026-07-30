package worker

import (
	"context"
	"log"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/orders/fsm"
	"github.com/proxyhubb/control-api/internal/solana"
)

// EscrowCleaner scans for expired escrows and triggers refunds
type EscrowCleaner struct {
	client *solana.OracleClient
}

func NewEscrowCleaner(client *solana.OracleClient) *EscrowCleaner {
	return &EscrowCleaner{client: client}
}

// Start runs the cleaner periodically
func (ec *EscrowCleaner) Start(ctx context.Context, interval time.Duration) {
	log.Printf("[EscrowCleaner] Started (Interval: %v)", interval)

	GoSupervised("EscrowCleaner", 5*time.Second, func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				RunSafely("EscrowCleaner.cycle", func() {
					ec.ScanAndRefund(ctx)
				})
			}
		}
	})
}

func (ec *EscrowCleaner) ScanAndRefund(ctx context.Context) {
	// 1. Find Orders that are in an actionable state and use Solana Escrow
	var orders []models.Order
	db.DB.Where("status IN ? AND payment_method = ?",
		[]models.OrderStatus{models.OrderStatusPending, models.OrderStatusPendingPayment, models.OrderStatusActive},
		"solana_escrow",
	).Find(&orders)

	if len(orders) == 0 {
		return
	}

	for _, order := range orders {
		if order.EscrowPDA == "" {
			continue
		}

		// 2. Fetch On-Chain State to confirm expiry
		pda := sol.MustPublicKeyFromBase58(order.EscrowPDA)
		escrow, err := ec.client.FetchEscrow(ctx, pda)
		if err != nil {
			log.Printf("[EscrowCleaner] Failed to fetch escrow %s: %v", order.EscrowPDA, err)
			continue
		}

		now := time.Now().Unix()
		if now > escrow.ExpiresAt {
			log.Printf("[EscrowCleaner] Escrow %s expired at %v. Triggering automated refund...", order.EscrowPDA, escrow.ExpiresAt)

			// 3. Trigger Refund (Full refund = Settle with 0 bandwidth)
			buyer := sol.MustPublicKeyFromBase58(order.BuyerWallet)
			seller := sol.MustPublicKeyFromBase58(order.SellerWallet)

			sig, err := ec.client.SettleEscrow(ctx, "worker.escrow_cleaner.expiry_refund", solana.SettleEscrowParams{
				Buyer:           buyer,
				Seller:          seller,
				EscrowPDA:       pda,
				BandwidthUsedGB: 0,
			})

			if err != nil {
				log.Printf("[EscrowCleaner] FAILED to refund escrow %s: %v", order.EscrowPDA, err)
				recordEscrowReconciliation(escrowReconciliationRecord{
					Source:    "escrow_cleaner",
					EventType: "expiry_refund",
					EscrowPDA: order.EscrowPDA,
					OrderID:   &order.ID,
					Status:    models.EscrowReconciliationStatusRefundFailed,
					Reason:    "settle_escrow_failed",
					LastError: err.Error(),
					Payload: map[string]interface{}{
						"order_id":          order.ID,
						"buyer_wallet":      order.BuyerWallet,
						"seller_wallet":     order.SellerWallet,
						"amount_locked_sol": order.AmountLockedSOL,
						"expires_at":        escrow.ExpiresAt,
					},
				})
				continue
			}

			log.Printf("[EscrowCleaner] SUCCESS: Refunded escrow %s (Tx: %s)", order.EscrowPDA, sig)
			markEscrowReconciliationResolved(order.EscrowPDA, sig, order.ID, "expiry_refund_succeeded")

			// 4. Update Database
			if err := fsm.TransitionOrder(db.DB, &order, models.OrderStatusRefunded, nil); err != nil {
				log.Printf("[EscrowCleaner] Invalid refund transition for order %s: %v", order.ID, err)
				recordEscrowReconciliation(escrowReconciliationRecord{
					Source:      "escrow_cleaner",
					EventType:   "expiry_refund",
					EscrowPDA:   order.EscrowPDA,
					TxSignature: sig,
					OrderID:     &order.ID,
					Status:      models.EscrowReconciliationStatusInvalidState,
					Reason:      "invalid_refund_transition",
					LastError:   err.Error(),
					Payload: map[string]interface{}{
						"order_id": order.ID,
						"status":   order.Status,
						"tx":       sig,
					},
				})
				continue
			}
		}
	}
}
