package worker

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/orders/fsm"
	"github.com/proxyhubb/control-api/internal/solana"
)

const defaultUnfundedEscrowTimeout = 2 * time.Hour

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

func unfundedEscrowTimeout() time.Duration {
	if raw := strings.TrimSpace(os.Getenv("PROXYHUB_UNFUNDED_ESCROW_TIMEOUT")); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil && d > 0 {
			return d
		}
	}
	return defaultUnfundedEscrowTimeout
}

// shouldCancelUnfundedPending reports whether a pending_payment order with no
// on-chain escrow account should be cancelled. RPC transport errors (429, timeouts)
// must not cancel — they do not prove the account is missing.
func shouldCancelUnfundedPending(status models.OrderStatus, fetchErr string, age, timeout time.Duration) bool {
	if status != models.OrderStatusPendingPayment {
		return false
	}
	if timeout <= 0 {
		timeout = defaultUnfundedEscrowTimeout
	}
	if age < timeout {
		return false
	}
	err := strings.ToLower(strings.TrimSpace(fetchErr))
	if err == "" {
		return true
	}
	if strings.Contains(err, "failed to fetch escrow account") {
		return false
	}
	return strings.Contains(err, "escrow account not found")
}

func (ec *EscrowCleaner) cancelUnfundedPending(order models.Order, reason string) {
	log.Printf("[EscrowCleaner] Cancelling unfunded pending_payment order %s (%s)", order.ID, reason)
	if err := fsm.TransitionOrder(db.DB, &order, models.OrderStatusCancelled, "worker.escrow_cleaner.unfunded_timeout", nil); err != nil {
		log.Printf("[EscrowCleaner] Invalid cancel transition for order %s: %v", order.ID, err)
		recordEscrowReconciliation(escrowReconciliationRecord{
			Source:    "escrow_cleaner",
			EventType: "unfunded_timeout",
			EscrowPDA: reconciliationPDA(order),
			OrderID:   &order.ID,
			Status:    models.EscrowReconciliationStatusInvalidState,
			Reason:    "invalid_cancel_transition",
			LastError: err.Error(),
			Payload: map[string]interface{}{
				"order_id": order.ID,
				"status":   order.Status,
			},
		})
		return
	}
	if order.SessionID != nil {
		var session models.Session
		if err := db.DB.First(&session, "id = ?", order.SessionID).Error; err == nil {
			if models.ValidateSessionStatusTransition(session.Status, models.SessionTerminated) == nil {
				_ = db.DB.Model(&session).Update("status", models.SessionTerminated).Error
			}
		}
	}
	recordEscrowReconciliation(escrowReconciliationRecord{
		Source:    "escrow_cleaner",
		EventType: "unfunded_timeout",
		EscrowPDA: reconciliationPDA(order),
		OrderID:   &order.ID,
		Status:    models.EscrowReconciliationStatusResolved,
		Reason:    reason,
		Payload: map[string]interface{}{
			"order_id": order.ID,
			"status":   order.Status,
		},
	})
}

func reconciliationPDA(order models.Order) string {
	if strings.TrimSpace(order.EscrowPDA) != "" {
		return order.EscrowPDA
	}
	return "unfunded:" + order.ID.String()
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

	timeout := unfundedEscrowTimeout()
	now := time.Now()

	for _, order := range orders {
		age := now.Sub(order.CreatedAt)
		if strings.TrimSpace(order.EscrowPDA) == "" {
			if shouldCancelUnfundedPending(order.Status, "", age, timeout) {
				ec.cancelUnfundedPending(order, "unfunded_timeout")
			}
			continue
		}

		pda, err := sol.PublicKeyFromBase58(order.EscrowPDA)
		if err != nil {
			log.Printf("[EscrowCleaner] Invalid escrow PDA on order %s: %v", order.ID, err)
			if shouldCancelUnfundedPending(order.Status, "escrow account not found", age, timeout) {
				ec.cancelUnfundedPending(order, "invalid_escrow_pda")
			}
			continue
		}

		// 2. Fetch On-Chain State to confirm expiry / existence
		escrow, err := ec.client.FetchEscrow(ctx, pda)
		if err != nil {
			if shouldCancelUnfundedPending(order.Status, err.Error(), age, timeout) {
				ec.cancelUnfundedPending(order, "unfunded_timeout")
				continue
			}
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
			if err := fsm.TransitionOrder(db.DB, &order, models.OrderStatusRefunded, "worker.escrow_cleaner", nil); err != nil {
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
