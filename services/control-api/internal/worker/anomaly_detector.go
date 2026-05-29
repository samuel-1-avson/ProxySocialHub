package worker

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/alerts"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

// AnomalyDetector runs periodic checks for suspicious wallet activity
type AnomalyDetector struct {
	checkInterval time.Duration
}

// NewAnomalyDetector creates a new AnomalyDetector instance
func NewAnomalyDetector(interval time.Duration) *AnomalyDetector {
	return &AnomalyDetector{
		checkInterval: interval,
	}
}

// Start begins the anomaly detection loop
func (ad *AnomalyDetector) Start(ctx context.Context) {
	ticker := time.NewTicker(ad.checkInterval)
	defer ticker.Stop()

	logging.Info().Msg("Anomaly detector worker started")

	for {
		select {
		case <-ctx.Done():
			logging.Info().Msg("Anomaly detector worker stopping")
			return
		case <-ticker.C:
			ad.checkAnomalies()
		}
	}
}

func (ad *AnomalyDetector) checkAnomalies() {
	// Look at ledger entries created in the last hour
	oneHourAgo := time.Now().Add(-1 * time.Hour)

	var entries []models.WalletLedgerEntry
	if err := db.DB.Where("created_at >= ?", oneHourAgo).Find(&entries).Error; err != nil {
		logging.Error(err).Msg("[Anomaly] Failed to fetch recent ledger entries")
		return
	}

	for _, entry := range entries {
		// Get User ID from Wallet ID
		var wallet models.Wallet
		if err := db.DB.Where("id = ?", entry.WalletID).First(&wallet).Error; err != nil {
			continue
		}

		switch entry.Type {
		case models.TransactionPayout: // Withdrawal
			ad.checkWithdrawalAnomalies(wallet.UserID, wallet.ID, entry.Amount)

		case "p2p_sent": // P2P Sent
			ad.checkP2PAnomalies(wallet.UserID, wallet.ID, entry.Amount, entry.Description)

		case models.TransactionUsage: // Usage
			ad.checkUsageAnomalies(wallet.UserID, wallet.ID, entry.Amount)
		}
	}
}

func (ad *AnomalyDetector) checkWithdrawalAnomalies(userID uuid.UUID, walletID uuid.UUID, amount float64) {
	// Rule 1: More than 5 withdrawals in 1 hour
	oneHourAgo := time.Now().Add(-1 * time.Hour)
	var payoutCount int64
	err := db.DB.Model(&models.WalletLedgerEntry{}).
		Where("wallet_id = ? AND type = ? AND created_at >= ?", walletID, models.TransactionPayout, oneHourAgo).
		Count(&payoutCount).Error
	if err == nil && payoutCount > 5 {
		ad.flagAccount(userID, "excessive_withdrawals", fmt.Sprintf("More than 5 withdrawals in the last hour (count: %d)", payoutCount))
	}

	// Rule 2: Withdrawal amount > 3x historical average
	absAmount := -amount // amount is negative for debit
	if absAmount > 1.0 { // threshold to avoid tiny withdrawals
		var avgPayout float64
		err = db.DB.Model(&models.WalletLedgerEntry{}).
			Where("wallet_id = ? AND type = ? AND created_at < ?", walletID, models.TransactionPayout, oneHourAgo).
			Select("COALESCE(AVG(ABS(amount)), 0)").
			Scan(&avgPayout).Error

		if err == nil && avgPayout > 0 && absAmount > (3*avgPayout) {
			ad.flagAccount(userID, "large_withdrawal_deviation",
				fmt.Sprintf("Withdrawal of %.6f SOL is > 3x the historical average of %.6f SOL", absAmount, avgPayout))
		}
	}
}

func (ad *AnomalyDetector) checkP2PAnomalies(userID uuid.UUID, walletID uuid.UUID, amount float64, description string) {
	absAmount := -amount // amount is negative for debit
	// Rule 3: P2P transfer to new recipient > 50 SOL
	if absAmount > 50.0 {
		oneHourAgo := time.Now().Add(-1 * time.Hour)
		recipient := strings.TrimPrefix(description, "Sent to ")

		// Check if user has sent P2P to this recipient historically
		var historicalCount int64
		err := db.DB.Model(&models.WalletLedgerEntry{}).
			Where("wallet_id = ? AND type = ? AND description = ? AND created_at < ?", walletID, "p2p_sent", description, oneHourAgo).
			Count(&historicalCount).Error

		if err == nil && historicalCount == 0 {
			ad.flagAccount(userID, "large_new_p2p_transfer",
				fmt.Sprintf("P2P transfer of %.6f SOL sent to a new recipient (%s)", absAmount, recipient))
		}
	}
}

func (ad *AnomalyDetector) checkUsageAnomalies(userID uuid.UUID, walletID uuid.UUID, amount float64) {
	absAmount := -amount // amount is negative for debit
	// Rule 4: Session spend > 10x normal usage pattern
	if absAmount > 0.5 { // threshold to avoid tiny usage noise
		oneHourAgo := time.Now().Add(-1 * time.Hour)
		var avgUsage float64
		err := db.DB.Model(&models.WalletLedgerEntry{}).
			Where("wallet_id = ? AND type = ? AND created_at < ?", walletID, models.TransactionUsage, oneHourAgo).
			Select("COALESCE(AVG(ABS(amount)), 0)").
			Scan(&avgUsage).Error

		if err == nil && avgUsage > 0 && absAmount > (10*avgUsage) {
			ad.flagAccount(userID, "excessive_usage_spend",
				fmt.Sprintf("Usage billing of %.6f SOL is > 10x the historical average of %.6f SOL", absAmount, avgUsage))
		}
	}
}

func (ad *AnomalyDetector) flagAccount(userID uuid.UUID, flagType string, reason string) {
	// Check if this active flag already exists to prevent duplication
	var existingFlag models.UserFlag
	err := db.DB.Where("user_id = ? AND flag_type = ? AND resolved = ?", userID, flagType, false).First(&existingFlag).Error
	if err == nil {
		return // Already flagged
	}

	flag := models.UserFlag{
		UserID:   userID,
		FlagType: flagType,
		Reason:   reason,
		Resolved: false,
	}

	if err := db.DB.Create(&flag).Error; err != nil {
		logging.Error(err).Msg("[Anomaly] Failed to create UserFlag in database")
		return
	}

	msg := fmt.Sprintf("User %s flagged: [%s] %s", userID, flagType, reason)
	logging.Warn().Str("user_id", userID.String()).Str("flag_type", flagType).Msg(reason)

	alerts.Send(alerts.Critical, "Account Anomaly Flagged", msg)
}
