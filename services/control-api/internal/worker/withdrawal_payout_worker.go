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

	seen := make(map[uuid.UUID]struct{})
	for i := 0; i < 25; i++ {
		var row models.WithdrawalPayout
		backoffBefore := time.Now().UTC().Add(-20 * time.Second)
		err := db.DB.Transaction(func(tx *gorm.DB) error {
			q := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
				Where("status IN ?", models.ActiveWithdrawalPayoutStatuses()).
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

		now := time.Now().UTC()
		_ = db.DB.Model(&models.WithdrawalPayout{}).Where("id = ?", row.ID).Updates(map[string]interface{}{
			"status":     models.WithdrawalPayoutCompleted,
			"tx_hash":    txHash,
			"paid_at":    now,
			"funded_at":  now,
			"last_error": "",
			"updated_at": now,
		}).Error
		_ = tm.RecordOutgoingTransfer(ctx, row.AmountSOL)
		logging.Info().
			Str("reference", row.Reference).
			Str("tx_hash", txHash).
			Float64("amount_sol", row.AmountSOL).
			Msg("Queued withdrawal paid")
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
	refundErr := db.DB.Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", row.UserID).First(&wallet).Error; err != nil {
			return err
		}
		desc := "Queued withdrawal failed: " + truncateErr(reason, 120) + " — balance restored"
		if err := models.CreditWalletLocked(tx, &wallet, row.AmountSOL, "withdrawal_failed_refund", row.Reference, desc); err != nil {
			return err
		}
		_ = tx.Where("wallet_id = ? AND user_id = ? AND type = ? AND reference = ?",
			wallet.ID, row.UserID, models.SpendingWithdraw, row.Reference).
			Delete(&models.SpendingRecord{}).Error
		now := time.Now().UTC()
		return tx.Model(&models.WithdrawalPayout{}).Where("id = ?", row.ID).Updates(map[string]interface{}{
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
