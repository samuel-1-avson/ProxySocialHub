package treasury

import (
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"gorm.io/gorm"
)

// LiabilitiesBreakdown is the lamports-exact internal liability picture
// (W-18). Every queue/hold that represents SOL owed to users or already
// debited-but-not-yet-on-chain is included; the old implementation
// summed float wallet balances in Go memory and looked for pending
// types nothing writes anymore, so DEFICIT/SURPLUS were systematically
// wrong exactly during incidents.
type LiabilitiesBreakdown struct {
	WalletBalancesLamports   int64 `json:"wallet_balances_lamports"`
	WithdrawalsInFlight      int64 `json:"withdrawals_in_flight_lamports"`
	PendingPayoutsLamports   int64 `json:"pending_payouts_lamports"`
	PayoutRetriesLamports    int64 `json:"payout_retries_lamports"`
	CompensationsLamports    int64 `json:"compensations_lamports"`
	EscrowHeldLamports       int64 `json:"escrow_held_lamports"`
	TotalLamports            int64 `json:"total_lamports"`
	// Skipped lists sources whose table is absent (partial schemas in
	// tests); production migrations create all of them.
	Skipped []string `json:"skipped_sources,omitempty"`
}

func tableExists(tx *gorm.DB, name string) bool {
	var reg *string
	if err := tx.Raw(`SELECT to_regclass('public.' || ?)::text`, name).Scan(&reg).Error; err != nil {
		return false
	}
	return reg != nil && *reg != ""
}

func sumLamports(tx *gorm.DB, query string, args ...interface{}) (int64, error) {
	var total *int64
	if err := tx.Raw(query, args...).Scan(&total).Error; err != nil {
		return 0, err
	}
	if total == nil {
		return 0, nil
	}
	return *total, nil
}

// ComputeLiabilitiesLamports sums every internal SOL liability in SQL,
// in integer lamports. Amounts already debited from wallets but not yet
// on-chain (withdrawal/payout queues) are included because the backing
// still sits in treasury/vault until broadcast.
func ComputeLiabilitiesLamports() (*LiabilitiesBreakdown, error) {
	b := &LiabilitiesBreakdown{}
	add := func(name, query string, dst *int64, args ...interface{}) {
		v, err := sumLamports(db.DB, query, args...)
		if err != nil {
			logging.Warn().Err(err).Str("source", name).Msg("[Reconciliation] liability source failed; skipped")
			b.Skipped = append(b.Skipped, name)
			return
		}
		*dst = v
		b.TotalLamports += v
	}

	if v, err := sumLamports(db.DB, `SELECT COALESCE(SUM(balance_lamports),0) FROM wallets`); err != nil {
		return nil, err
	} else {
		b.WalletBalancesLamports = v
		b.TotalLamports += v
	}

	if tableExists(db.DB, "withdrawal_payout_queue") {
		add("withdrawal_payout_queue",
			`SELECT COALESCE(SUM(ROUND(amount_sol * 1000000000)::bigint),0) FROM withdrawal_payout_queue WHERE status IN ('requested','funding','paying')`,
			&b.WithdrawalsInFlight)
	} else {
		b.Skipped = append(b.Skipped, "withdrawal_payout_queue")
	}
	if tableExists(db.DB, "pending_payouts") {
		// Queued + claimed-but-not-submitted batch payouts: debited from
		// wallets, not yet broadcast (submitted batches already left the
		// hot wallet on-chain, so they are excluded to avoid double count).
		add("pending_payouts",
			`SELECT COALESCE(SUM(ROUND(pp.amount_sol * 1000000000)::bigint),0)
			 FROM pending_payouts pp
			 LEFT JOIN batch_payouts bp ON bp.id = pp.batch_id
			 WHERE pp.status = 'queued'
			    OR (pp.status = 'claimed' AND (bp.id IS NULL OR bp.status NOT IN ('submitted','completed')))`,
			&b.PendingPayoutsLamports)
	} else {
		b.Skipped = append(b.Skipped, "pending_payouts")
	}
	if tableExists(db.DB, "payout_retry_queue") {
		add("payout_retry_queue",
			`SELECT COALESCE(SUM(ROUND(amount_sol * 1000000000)::bigint),0) FROM payout_retry_queue WHERE status = 'pending'`,
			&b.PayoutRetriesLamports)
	} else {
		b.Skipped = append(b.Skipped, "payout_retry_queue")
	}
	if tableExists(db.DB, "compensation_outbox") {
		add("compensation_outbox",
			`SELECT COALESCE(SUM(ROUND(amount_sol * 1000000000)::bigint),0) FROM compensation_outbox WHERE status = 'pending'`,
			&b.CompensationsLamports)
	} else {
		b.Skipped = append(b.Skipped, "compensation_outbox")
	}
	if tableExists(db.DB, "escrow_transactions") {
		add("escrow_transactions",
			`SELECT COALESCE(SUM(ROUND(amount * 1000000000)::bigint),0) FROM escrow_transactions WHERE status IN ('held','releasing','disputed')`,
			&b.EscrowHeldLamports)
	} else {
		b.Skipped = append(b.Skipped, "escrow_transactions")
	}
	return b, nil
}
