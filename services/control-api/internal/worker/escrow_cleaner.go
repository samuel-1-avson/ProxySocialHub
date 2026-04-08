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
		[]models.OrderStatus{models.OrderStatusPending, models.OrderStatusActive},
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
				continue
			}

			log.Printf("[EscrowCleaner] SUCCESS: Refunded escrow %s (Tx: %s)", order.EscrowPDA, sig)

			// 4. Update Database
			db.DB.Model(&order).Updates(map[string]interface{}{
				"status":     models.OrderStatusRefunded,
				"updated_at": time.Now(),
			})
		}
	}
}
