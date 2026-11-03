package accountclosure

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
	"time"
)

var ErrUnsettled = errors.New("settle active services, funds, and pending payouts before account closure")

// Check is used at scheduling and again inside the purge transaction. Every
// query is mandatory: a database/RPC outage must never authorize key destruction.
func Check(ctx context.Context, tx *gorm.DB, uid uuid.UUID, purge bool) error {
	checks := []struct {
		table, predicate string
		args             []interface{}
	}{
		{"wallets", "user_id = ? AND (balance_lamports <> 0 OR balance_sol <> 0 OR earnings_payable_lamports <> 0)", []interface{}{uid}},
		{"orders", "(buyer_id = ? OR seller_id = ?) AND status NOT IN ?", []interface{}{uid, uid, []string{"completed", "cancelled", "refunded"}}},
		{"sessions", "user_id = ? AND deleted_at IS NULL AND status IN ?", []interface{}{uid, []string{"active", "pending_payment", "activation_pending"}}},
		{"cashouts", "user_id = ? AND status IN ?", []interface{}{uid, []string{"confirmed", "sweeping", "swept", "transferring", "refunding", "failed"}}},
		{"pending_payouts", "provider_id = ? AND status <> ?", []interface{}{uid, "completed"}},
		{"withdrawal_payout_queue", "user_id = ? AND status <> ?", []interface{}{uid, "completed"}},
		{"pending_transactions", "user_id = ? AND status = ?", []interface{}{uid, "pending"}},
		{"session_intents", "user_id = ? AND deleted_at IS NULL AND lifecycle_state IN ?", []interface{}{uid, []string{"authorized", "routed", "active", "closing"}}},
	}
	for _, check := range checks {
		var n int64
		if err := tx.Table(check.table).Where(check.predicate, check.args...).Count(&n).Error; err != nil {
			return err
		}
		if n > 0 {
			return ErrUnsettled
		}
	}
	if !purge {
		return nil
	}
	var wallets []models.EmbeddedWallet
	if err := tx.Where("user_id = ?", uid).Find(&wallets).Error; err != nil {
		return err
	}
	for _, wallet := range wallets {
		oracle := solana.GetOracleClient()
		if oracle == nil {
			return errors.New("managed wallet closure awaits an available chain verifier")
		}
		bounded, cancel := context.WithTimeout(ctx, 15*time.Second)
		err := oracle.CheckWalletEmpty(bounded, wallet.Address)
		cancel()
		if err != nil {
			return err
		}
	}
	return nil
}
