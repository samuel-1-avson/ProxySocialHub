package worker

import (
	"context"
	"fmt"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/alerts"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/treasury"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	withdrawalPayoutPollInterval = 15 * time.Second
	withdrawalPayoutMaxAttempts  = 40
	withdrawalFeeHeadroom        = uint64(10_000)
	// withdrawalSubmittedMaxAge bounds a broadcast-but-unconfirmed payout
	// before manual review. Never auto-refunded (P0-3).
	withdrawalSubmittedMaxAge = 30 * time.Minute
	// withdrawalPayingStaleAfter bounds a claimed row whose send outcome is
	// unknown; stale paying rows are parked, never re-sent (P0-3).
	withdrawalPayingStaleAfter = 5 * time.Minute
)

// StartWithdrawalPayoutWorker drains the user withdrawal queue after vault→hot liquidity arrives.
func StartWithdrawalPayoutWorker(ctx context.Context) {
	GoSupervised("WithdrawalPayoutWorker", 5*time.Second, func() {
		runWithdrawalPayoutWorker(ctx)
	})
}

func runWithdrawalPayoutWorker(ctx context.Context) {
	ticker := time.NewTicker(withdrawalPayoutPollInterval)
	defer ticker.Stop()

	logging.Info().Msg("Withdrawal payout worker started")
	drainWithdrawalPayoutQueue(ctx)

	for {
		select {
		case <-ctx.Done():
			logging.Info().Msg("Withdrawal payout worker shutting down")
			return
		case <-ticker.C:
			drainWithdrawalPayoutQueue(ctx)
		case <-treasury.PayoutDrainNotify():
			drainWithdrawalPayoutQueue(ctx)
		}
	}
}

func drainWithdrawalPayoutQueue(ctx context.Context) {
	if db.DB == nil {
		return
	}
	oracle := solana.GetOracleClient()
	if oracle == nil {
		return
	}
	tm := treasury.GetManager()

	confirmSubmittedWithdrawals(ctx, oracle, tm)
	parkStalePayingWithdrawals()

	seen := make(map[uuid.UUID]struct{})
	for i := 0; i < 25; i++ {
		var row models.WithdrawalPayout
		backoffBefore := time.Now().UTC().Add(-20 * time.Second)
		err := db.DB.Transaction(func(tx *gorm.DB) error {
			q := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
				Where("status IN ?", []string{models.WithdrawalPayoutRequested, models.WithdrawalPayoutFunding, models.WithdrawalPayoutOpsRequired}).
				Where("updated_at < ? OR attempts = 0", backoffBefore).
				Order("created_at ASC")
			if err := q.First(&row).Error; err != nil {
				return err
			}
			if _, ok := seen[row.ID]; ok {
				return gorm.ErrRecordNotFound
			}
			now := time.Now().UTC()
			return tx.Model(&row).Updates(map[string]interface{}{
				"status":     models.WithdrawalPayoutFunding,
				"attempts":   row.Attempts + 1,
				"updated_at": now,
			}).Error
		})
		if err == gorm.ErrRecordNotFound {
			return
		}
		if err != nil {
			logging.Warn().Err(err).Msg("withdrawal payout: claim failed")
			return
		}
		seen[row.ID] = struct{}{}

		if err := db.DB.Where("id = ?", row.ID).First(&row).Error; err != nil {
			continue
		}

		needLamports := solana.SOLToLamports(row.AmountSOL) + withdrawalFeeHeadroom
		payoutPK := oracle.GetPayoutPublicKey()
		balCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		bal, balErr := oracle.GetBalance(balCtx, payoutPK)
		cancel()
		if balErr != nil {
			_ = markWithdrawalPayoutError(row.ID, models.WithdrawalPayoutFunding, balErr.Error())
			continue
		}

		if bal < needLamports {
			topCtx, topCancel := context.WithTimeout(ctx, 45*time.Second)
			_, topErr := tm.EnsureHotLiquidity(topCtx, needLamports)
			topCancel()
			if topErr != nil {
				status := models.WithdrawalPayoutFunding
				if row.Attempts >= 3 {
					status = models.WithdrawalPayoutOpsRequired
					tm.ProposeColdToHotIfNeeded(ctx, row.AmountSOL, topErr.Error())
				}
				_ = markWithdrawalPayoutError(row.ID, status, topErr.Error())
				if row.Attempts >= withdrawalPayoutMaxAttempts {
					failAndRefundWithdrawal(row, "payout liquidity exhausted after retries")
				}
				continue
			}
			balCtx2, cancel2 := context.WithTimeout(ctx, 20*time.Second)
			bal, balErr = oracle.GetBalance(balCtx2, payoutPK)
			cancel2()
			if balErr != nil || bal < needLamports {
				_ = markWithdrawalPayoutError(row.ID, models.WithdrawalPayoutFunding, "hot still underfunded after vault top-up")
				continue
			}
		}

		_ = db.DB.Model(&models.WithdrawalPayout{}).Where("id = ?", row.ID).Updates(map[string]interface{}{
			"status":     models.WithdrawalPayoutPaying,
			"updated_at": time.Now().UTC(),
		}).Error

		sendCtx, sendCancel := context.WithTimeout(ctx, 45*time.Second)
		recipient, parseErr := sol.PublicKeyFromBase58(row.Destination)
		if parseErr != nil {
			sendCancel()
			failAndRefundWithdrawal(row, "invalid destination address")
			continue
		}
		txHash, sendErr := oracle.SendSOL(sendCtx, recipient, solana.SOLToLamports(row.AmountSOL))
		sendCancel()
		if sendErr != nil {
			_ = markWithdrawalPayoutError(row.ID, models.WithdrawalPayoutFunding, sendErr.Error())
			if row.Attempts >= withdrawalPayoutMaxAttempts {
				failAndRefundWithdrawal(row, sendErr.Error())
			}
			continue
		}

		// P0-3: persist submitted + tx hash before any completion claim.
		now := time.Now().UTC()
		if updErr := db.DB.Model(&models.WithdrawalPayout{}).Where("id = ?", row.ID).Updates(map[string]interface{}{
			"status":     models.WithdrawalPayoutSubmitted,
			"tx_hash":    txHash,
			"paid_at":    now,
			"funded_at":  now,
			"last_error": "",
			"updated_at": now,
		}).Error; updErr != nil {
			logging.Error(updErr).Str("reference", row.Reference).Str("tx_hash", txHash).
				Msg("CRITICAL: queued withdrawal sent but submitted state not persisted")
			alerts.Send(alerts.Critical, "Queued Withdrawal Sent But State Not Persisted",
				fmt.Sprintf("ref=%s tx=%s amount=%.6f", row.Reference, txHash, row.AmountSOL))
			continue
		}
		row.TxHash = txHash
		row.Status = models.WithdrawalPayoutSubmitted
		confirmCtx, confirmCancel := context.WithTimeout(ctx, 20*time.Second)
		state := solana.WaitForTxConfirmation(confirmCtx, oracle, txHash)
		confirmCancel()
		switch state {
		case solana.TxConfirmed:
			markWithdrawalPayoutCompleted(ctx, tm, row)
		case solana.TxFailed:
			failAndRefundWithdrawal(row, "on-chain transaction failed")
		default:
			logging.Info().Str("reference", row.Reference).Str("tx_hash", txHash).
				Msg("Queued withdrawal submitted; awaiting confirmation sweep")
		}
	}
}

func markWithdrawalPayoutError(id uuid.UUID, status, errMsg string) error {
	return db.DB.Model(&models.WithdrawalPayout{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status":     status,
		"last_error": truncateErr(errMsg, 500),
		"updated_at": time.Now().UTC(),
	}).Error
}

func failAndRefundWithdrawal(row models.WithdrawalPayout, reason string) {
	// P0-3 safety net: a broadcast withdrawal may only be refunded when
	// the chain proves the tx failed; otherwise park for manual review.
	if row.TxHash != "" && row.Status == models.WithdrawalPayoutSubmitted {
		if solana.CheckTxConfirmed(context.Background(), solana.GetOracleClient(), row.TxHash) != solana.TxFailed {
			_ = markWithdrawalPayoutError(row.ID, models.WithdrawalPayoutOpsRequired,
				"refund blocked: submitted tx not proven failed on-chain")
			alerts.Send(alerts.Critical, "Withdrawal Refund Blocked Pending Chain Proof",
				fmt.Sprintf("ref=%s tx=%s reason=%s", row.Reference, row.TxHash, reason))
			return
		}
	}
	refundErr := db.DB.Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", row.UserID).First(&wallet).Error; err != nil {
			return err
		}
		// Idempotence: never credit twice for the same reference.
		var existingRefunds int64
		if err := tx.Model(&models.WalletLedgerEntry{}).
			Where("reference_id = ? AND type = ?", row.Reference, models.LedgerKindWithdrawalFailedRefund).
			Count(&existingRefunds).Error; err != nil {
			return err
		}
		if existingRefunds == 0 {
			desc := "Queued withdrawal failed: " + truncateErr(reason, 120) + ". Your balance was restored."
			if err := models.CreditWalletLocked(tx, &wallet, row.AmountSOL, models.LedgerKindWithdrawalFailedRefund, row.Reference, desc); err != nil {
				return err
			}
			// W-33: compensating reversal, never DELETE spending history.
			if err := models.ReverseSpendingForReference(tx, wallet.ID, row.UserID, models.SpendingWithdraw, row.Reference); err != nil {
				return err
			}
		}
		now := time.Now().UTC()
		return tx.Model(&models.WithdrawalPayout{}).Where("id = ? AND status != ?", row.ID, models.WithdrawalPayoutCompleted).Updates(map[string]interface{}{
			"status":     models.WithdrawalPayoutFailed,
			"last_error": truncateErr(reason, 500),
			"updated_at": now,
		}).Error
	})
	if refundErr != nil {
		logging.Error(refundErr).
			Str("reference", row.Reference).
			Msg("CRITICAL: queued withdrawal refund failed")
		alerts.Send(alerts.Critical, "Queued Withdrawal Refund Failed",
			fmt.Sprintf("ref=%s user=%s amount=%.6f err=%v", row.Reference, row.UserID, row.AmountSOL, refundErr))
		return
	}
	logging.Warn().Str("reference", row.Reference).Msg("Queued withdrawal failed; balance restored")
}

func truncateErr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// QueueDepthStats returns active queue depth and oldest age for treasury metrics.
func QueueDepthStats() (depth int64, oldestAgeSecs int64) {
	if db.DB == nil {
		return 0, 0
	}
	db.DB.Model(&models.WithdrawalPayout{}).
		Where("status IN ?", models.ActiveWithdrawalPayoutStatuses()).
		Count(&depth)
	var oldest models.WithdrawalPayout
	if err := db.DB.Where("status IN ?", models.ActiveWithdrawalPayoutStatuses()).
		Order("created_at ASC").First(&oldest).Error; err == nil {
		oldestAgeSecs = int64(time.Since(oldest.CreatedAt).Seconds())
	}
	return depth, oldestAgeSecs
}

func markWithdrawalPayoutCompleted(ctx context.Context, tm *treasury.TreasuryManager, row models.WithdrawalPayout) {
	if err := db.DB.Model(&models.WithdrawalPayout{}).
		Where("id = ? AND status != ?", row.ID, models.WithdrawalPayoutCompleted).
		Update("status", models.WithdrawalPayoutCompleted).Error; err != nil {
		logging.Error(err).Str("reference", row.Reference).Msg("withdrawal payout: failed to mark completed")
		return
	}
	if tm != nil {
		_ = tm.RecordOutgoingTransfer(ctx, row.AmountSOL)
	}
	logging.Info().
		Str("reference", row.Reference).
		Str("tx_hash", row.TxHash).
		Float64("amount_sol", row.AmountSOL).
		Msg("Queued withdrawal paid")
}

// confirmSubmittedWithdrawals polls broadcast-but-unconfirmed payouts (P0-3).
func confirmSubmittedWithdrawals(ctx context.Context, oracle *solana.OracleClient, tm *treasury.TreasuryManager) {
	var rows []models.WithdrawalPayout
	if err := db.DB.Where("status = ?", models.WithdrawalPayoutSubmitted).
		Order("created_at ASC").Limit(25).Find(&rows).Error; err != nil {
		logging.Error(err).Msg("withdrawal payout: submitted sweep query failed")
		return
	}
	for _, row := range rows {
		switch solana.CheckTxConfirmed(ctx, oracle, row.TxHash) {
		case solana.TxConfirmed:
			markWithdrawalPayoutCompleted(ctx, tm, row)
		case solana.TxFailed:
			failAndRefundWithdrawal(row, "on-chain transaction failed")
		default:
			if time.Since(row.CreatedAt) > withdrawalSubmittedMaxAge {
				_ = markWithdrawalPayoutError(row.ID, models.WithdrawalPayoutOpsRequired,
					"submitted transaction unconfirmed beyond max age; manual review (never auto-refunded)")
				alerts.Send(alerts.Critical, "Withdrawal Unconfirmed Beyond Max Age",
					fmt.Sprintf("ref=%s tx=%s amount=%.6f", row.Reference, row.TxHash, row.AmountSOL))
			}
		}
	}
}

// parkStalePayingWithdrawals parks claimed rows whose send outcome is
// unknown (crash/timeout mid-send). Never auto-re-sent (P0-3).
func parkStalePayingWithdrawals() {
	cutoff := time.Now().UTC().Add(-withdrawalPayingStaleAfter)
	res := db.DB.Model(&models.WithdrawalPayout{}).
		Where("status = ? AND tx_hash = '' AND updated_at < ?", models.WithdrawalPayoutPaying, cutoff).
		Updates(map[string]interface{}{
			"status":     models.WithdrawalPayoutOpsRequired,
			"last_error": "send outcome ambiguous (stale paying); manual review before any re-send or refund",
			"updated_at": time.Now().UTC(),
		})
	if res.Error == nil && res.RowsAffected > 0 {
		alerts.Send(alerts.Critical, "Ambiguous Withdrawal Sends Parked",
			fmt.Sprintf("%d withdrawal payout row(s) stuck in paying without tx hash", res.RowsAffected))
	}
}
