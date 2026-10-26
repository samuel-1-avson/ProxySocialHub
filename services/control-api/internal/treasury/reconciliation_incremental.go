package treasury

import (
	"fmt"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
)

// P2-G: incremental reconciliation + queue SLO stats.
//
// The aggregate liabilities check (W-18) proves the totals; the
// incremental pass proves PER-WALLET balance == Σ ledger, but only for
// wallets whose ledger changed since the watermark - O(changed), not
// O(all wallets), per run. The watermark advances only after a fully
// successful verification, so a crashed run re-checks the same window.
//
// Queue SLO stats give every money queue the same three numbers -
// depth, oldest age, dead-letter count - so a stuck queue is visible
// in one report instead of five log greps.

type WalletMismatch struct {
	WalletID       string `json:"wallet_id"`
	BalanceLamports int64 `json:"balance_lamports"`
	LedgerLamports  int64 `json:"ledger_lamports"`
	DiffLamports    int64 `json:"diff_lamports"`
}

type IncrementalVerification struct {
	Since          time.Time        `json:"since"`
	WalletsChanged int              `json:"wallets_changed"`
	WalletsChecked int              `json:"wallets_checked"`
	Mismatches     []WalletMismatch `json:"mismatches,omitempty"`
}

type QueueSLOStat struct {
	Queue          string `json:"queue"`
	Depth          int64  `json:"depth"`
	OldestAgeSeconds int64 `json:"oldest_age_seconds"`
	DeadLetter     int64  `json:"dead_letter"`
	Skipped        bool   `json:"skipped,omitempty"`
}

func ensureReconStateTable() error {
	return db.DB.Exec(`CREATE TABLE IF NOT EXISTS treasury_recon_state (
		id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
		last_verified_at TIMESTAMPTZ NOT NULL DEFAULT 'epoch',
		updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`).Error
}

// LoadReconWatermark returns the last successfully verified instant
// (epoch when never run - i.e. verify everything once).
func LoadReconWatermark() (time.Time, error) {
	if err := ensureReconStateTable(); err != nil {
		return time.Time{}, err
	}
	var ts *time.Time
	err := db.DB.Raw(`SELECT last_verified_at FROM treasury_recon_state WHERE id = 1`).Scan(&ts).Error
	if err != nil || ts == nil {
		return time.Unix(0, 0).UTC(), err
	}
	return *ts, nil
}

// SaveReconWatermark advances the watermark (only call after a fully
// successful verification of the window).
func SaveReconWatermark(at time.Time) error {
	if err := ensureReconStateTable(); err != nil {
		return err
	}
	return db.DB.Exec(`INSERT INTO treasury_recon_state (id, last_verified_at, updated_at)
		VALUES (1, ?, now())
		ON CONFLICT (id) DO UPDATE SET last_verified_at = EXCLUDED.last_verified_at, updated_at = now()`, at).Error
}

// VerifyChangedWallets checks balance_lamports == Σ ledger lamports
// for every wallet with ledger activity after `since`.
func VerifyChangedWallets(since time.Time) (*IncrementalVerification, error) {
	out := &IncrementalVerification{Since: since}
	type row struct {
		WalletID       string
		BalanceLamports int64
		LedgerLamports  int64
	}
	var rows []row
	err := db.DB.Raw(`
		SELECT w.id::text AS wallet_id,
		       w.balance_lamports AS balance_lamports,
		       COALESCE(SUM(e.amount_lamports), 0) AS ledger_lamports
		FROM wallets w
		JOIN wallet_ledger_entries e ON e.wallet_id = w.id
		WHERE w.id IN (
		    SELECT DISTINCT wallet_id FROM wallet_ledger_entries WHERE created_at > ?
		)
		GROUP BY w.id, w.balance_lamports`, since).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("verify changed wallets: %w", err)
	}
	out.WalletsChanged = len(rows)
	out.WalletsChecked = len(rows)
	for _, r := range rows {
		if r.BalanceLamports != r.LedgerLamports {
			out.Mismatches = append(out.Mismatches, WalletMismatch{
				WalletID: r.WalletID, BalanceLamports: r.BalanceLamports,
				LedgerLamports: r.LedgerLamports, DiffLamports: r.BalanceLamports - r.LedgerLamports,
			})
		}
	}
	return out, nil
}

type queueSpec struct {
	name       string
	table      string
	activeCond string // SQL WHERE fragment for in-flight rows
	deadCond   string // SQL WHERE fragment for dead-letter rows ("" = none)
	ageColumn  string
}

var moneyQueues = []queueSpec{
	{"withdrawal_payouts", "withdrawal_payout_queue",
		"status IN ('requested','funding','paying','submitted')", "status = 'ops_required'", "created_at"},
	{"provider_pending_payouts", "pending_payouts",
		"status IN ('queued','claimed')", "status = 'failed'", "created_at"},
	{"payout_retry", "payout_retry_queue",
		"status = 'pending'", "status IN ('dead','failed','exhausted')", "created_at"},
	{"compensation_outbox", "compensation_outbox",
		"status = 'pending'", "status = 'failed_permanent'", "created_at"},
	{"usage_metering_claims", "usage_metering_claims",
		"settled_at IS NULL", "", "created_at"},
}

// ComputeQueueSLOStats returns depth/oldest-age/dead-letter for every
// money queue. Missing tables are reported as skipped, never fatal.
func ComputeQueueSLOStats() []QueueSLOStat {
	stats := make([]QueueSLOStat, 0, len(moneyQueues))
	now := time.Now().UTC()
	for _, q := range moneyQueues {
		st := QueueSLOStat{Queue: q.name}
		if !tableExists(db.DB, q.table) {
			st.Skipped = true
			stats = append(stats, st)
			continue
		}
		var depth int64
		_ = db.DB.Raw(fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE %s`, q.table, q.activeCond)).Scan(&depth).Error
		st.Depth = depth
		if depth > 0 {
			var oldest *time.Time
			_ = db.DB.Raw(fmt.Sprintf(`SELECT MIN(%s) FROM %s WHERE %s`, q.ageColumn, q.table, q.activeCond)).Scan(&oldest).Error
			if oldest != nil {
				st.OldestAgeSeconds = int64(now.Sub(*oldest).Seconds())
			}
		}
		if q.deadCond != "" {
			var dead int64
			_ = db.DB.Raw(fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE %s`, q.table, q.deadCond)).Scan(&dead).Error
			st.DeadLetter = dead
		}
		stats = append(stats, st)
	}
	return stats
}

