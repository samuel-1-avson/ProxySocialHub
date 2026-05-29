// Package treasury - Ledger Reconciliation Service
// Ensures internal ledger balances match on-chain treasury state
package treasury

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/alerts"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/nats"
	"github.com/proxyhubb/control-api/internal/solana"
)

// ReconciliationService performs automated reconciliation between
// internal ledger balances and on-chain treasury state
type ReconciliationService struct {
	oracle     *solana.OracleClient
	treasuryAddr string
	discrepancyThreshold float64 // Minimum discrepancy to trigger alert (in SOL)
}

// ReconciliationReport contains the results of a reconciliation run
type ReconciliationReport struct {
	Timestamp         time.Time              `json:"timestamp"`
	TreasuryBalance   float64                `json:"treasury_balance_sol"`
	InternalLiabilities float64              `json:"internal_liabilities_sol"`
	Discrepancy       float64                `json:"discrepancy_sol"`
	Status            string                 `json:"status"` // MATCHED, DISCREPANCY, ERROR
	UserBalances      []UserBalanceSummary   `json:"user_balances,omitempty"`
	Issues            []ReconciliationIssue  `json:"issues,omitempty"`
}

// UserBalanceSummary represents a user's balance for reconciliation (SOL-only)
type UserBalanceSummary struct {
	UserID     string  `json:"user_id"`
	BalanceSOL float64 `json:"balance_sol"`
}

// ReconciliationIssue represents a detected discrepancy
type ReconciliationIssue struct {
	Type        string  `json:"type"`
	Severity    string  `json:"severity"` // INFO, WARNING, CRITICAL
	Description string  `json:"description"`
	Amount      float64 `json:"amount,omitempty"`
}

// NewReconciliationService creates a new reconciliation service
func NewReconciliationService() *ReconciliationService {
	oracle := solana.GetOracleClient()
	
	return &ReconciliationService{
		oracle:               oracle,
		treasuryAddr:         solana.GetTreasuryAddress(),
		discrepancyThreshold: 0.01, // 0.01 SOL threshold
	}
}

// StartReconciliationWorker begins the automated reconciliation schedule
func (rs *ReconciliationService) StartReconciliationWorker(ctx context.Context) {
	// Run immediately on start
	if err := rs.RunReconciliation(ctx); err != nil {
		logging.Error(err).Msg("Initial reconciliation failed")
	}

	// Start hourly user balance reconciliation
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		
		// Run once on startup
		if err := rs.ReconcileUserWallets(ctx); err != nil {
			logging.Error(err).Msg("Hourly user balance reconciliation failed")
		}

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := rs.ReconcileUserWallets(ctx); err != nil {
					logging.Error(err).Msg("Hourly user balance reconciliation failed")
				}
			}
		}
	}()

	// Schedule daily reconciliation at 00:00 UTC
	now := time.Now().UTC()
	nextRun := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
	initialDelay := nextRun.Sub(now)

	time.AfterFunc(initialDelay, func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				logging.Info().Msg("Reconciliation worker shutting down")
				return
			case <-ticker.C:
				if err := rs.RunReconciliation(ctx); err != nil {
					logging.Error(err).Msg("Scheduled reconciliation failed")
				}
			}
		}
	})

	logging.Info().
		Dur("initial_delay", initialDelay).
		Msg("Reconciliation worker scheduled")
}

// RunReconciliation performs a full reconciliation between internal and on-chain state
func (rs *ReconciliationService) RunReconciliation(ctx context.Context) error {
	logging.Info().Msg("Starting ledger reconciliation...")
	start := time.Now()

	report := &ReconciliationReport{
		Timestamp: time.Now().UTC(),
		Status:    "ERROR",
		Issues:    make([]ReconciliationIssue, 0),
	}

	defer func() {
		duration := time.Since(start)
		logging.Info().
			Str("status", report.Status).
			Dur("duration", duration).
			Float64("discrepancy", report.Discrepancy).
			Msg("Reconciliation completed")

		// P2-09: Persist report to DB for historical queries.
		rs.saveReport(report, duration)

		// Publish report to NATS
		rs.publishReport(ctx, report)
	}()

	// 1. Get on-chain treasury balance
	treasuryBalance, err := rs.getTreasuryBalance(ctx)
	if err != nil {
		report.Issues = append(report.Issues, ReconciliationIssue{
			Type:        "TREASURY_READ_ERROR",
			Severity:    "CRITICAL",
			Description: fmt.Sprintf("Failed to read treasury balance: %v", err),
		})
		return err
	}
	report.TreasuryBalance = treasuryBalance

	// 2. Calculate internal liabilities (sum of all user balances)
	internalLiabilities, userBalances, err := rs.calculateInternalLiabilities()
	if err != nil {
		report.Issues = append(report.Issues, ReconciliationIssue{
			Type:        "INTERNAL_CALCULATION_ERROR",
			Severity:    "CRITICAL",
			Description: fmt.Sprintf("Failed to calculate internal liabilities: %v", err),
		})
		return err
	}
	report.InternalLiabilities = internalLiabilities
	report.UserBalances = userBalances

	// 3. Calculate discrepancy
	// The treasury should have at least the sum of all user balances
	// Plus platform fees collected (positive discrepancy)
	discrepancy := treasuryBalance - internalLiabilities
	report.Discrepancy = discrepancy

	// 4. Determine status
	if abs(discrepancy) <= rs.discrepancyThreshold {
		report.Status = "MATCHED"
		logging.Info().
			Float64("treasury", treasuryBalance).
			Float64("liabilities", internalLiabilities).
			Float64("discrepancy", discrepancy).
			Msg("Reconciliation: Balances matched within threshold")
	} else if discrepancy > 0 {
		// Treasury has more than liabilities - this is expected (platform fees)
		report.Status = "SURPLUS"
		report.Issues = append(report.Issues, ReconciliationIssue{
			Type:        "TREASURY_SURPLUS",
			Severity:    "INFO",
			Description: fmt.Sprintf("Treasury surplus of %.6f SOL (platform fees)", discrepancy),
			Amount:      discrepancy,
		})
		logging.Info().
			Float64("surplus", discrepancy).
			Msg("Reconciliation: Treasury has surplus (expected from fees)")
	} else {
		// Treasury has less than liabilities - CRITICAL
		report.Status = "DEFICIT"
		report.Issues = append(report.Issues, ReconciliationIssue{
			Type:        "TREASURY_DEFICIT",
			Severity:    "CRITICAL",
			Description: fmt.Sprintf("Treasury deficit of %.6f SOL - liabilities exceed assets!", abs(discrepancy)),
			Amount:      discrepancy,
		})
		logging.Error(fmt.Errorf("treasury deficit detected")).
			Float64("deficit", abs(discrepancy)).
			Float64("treasury", treasuryBalance).
			Float64("liabilities", internalLiabilities).
			Msg("CRITICAL: Treasury deficit detected!")
		alerts.Send(alerts.Critical, "Treasury Deficit Detected",
			fmt.Sprintf("Deficit: %.6f SOL | Treasury: %.6f SOL | Liabilities: %.6f SOL",
				abs(discrepancy), treasuryBalance, internalLiabilities))
	}

	// 5. Check for additional issues
	rs.checkAdditionalIssues(report)

	return nil
}

// getTreasuryBalance retrieves the current on-chain treasury balance
func (rs *ReconciliationService) getTreasuryBalance(ctx context.Context) (float64, error) {
	if rs.oracle == nil {
		return 0, fmt.Errorf("oracle client not available")
	}

	// Get treasury address
	addr := solana.GetTreasuryAddress()
	if addr == "" {
		return 0, fmt.Errorf("treasury address not configured")
	}

	pk, err := sol.PublicKeyFromBase58(addr)
	if err != nil {
		return 0, fmt.Errorf("invalid treasury address: %w", err)
	}

	balance, err := rs.oracle.GetBalance(ctx, pk)
	if err != nil {
		return 0, err
	}

	return solana.LamportsToSOL(balance), nil
}

// calculateInternalLiabilities sums all user wallet balances plus any amounts
// committed in pending outgoing transactions (withdrawals that have been
// deducted from wallet balances but not yet settled on-chain).
//
// P2-08: Including pending_outgoing prevents a false DEFICIT signal when a
// withdrawal is in-flight: the wallet balance was already debited, but the
// on-chain treasury balance has not yet decreased.
func (rs *ReconciliationService) calculateInternalLiabilities() (float64, []UserBalanceSummary, error) {
	var wallets []models.Wallet
	if err := db.DB.Find(&wallets).Error; err != nil {
		return 0, nil, err
	}

	var total float64
	summaries := make([]UserBalanceSummary, 0, len(wallets))

	for _, wallet := range wallets {
		total += wallet.BalanceSOL
		summaries = append(summaries, UserBalanceSummary{
			UserID:     wallet.UserID.String(),
			BalanceSOL: wallet.BalanceSOL,
		})
	}

	// Add pending outgoing SOL amounts (withdrawals in-flight to the chain).
	// These reduce the treasury balance without yet reducing wallet balances.
	var pendingResult struct{ Total float64 }
	err := db.DB.Model(&models.PendingTransaction{}).
		Select("COALESCE(SUM(amount), 0) AS total").
		Where("status = ? AND currency = ? AND type IN ?",
			"pending", "SOL", []string{"withdrawal", "payout", "batch_payout"}).
		Scan(&pendingResult).Error
	if err != nil {
		logging.Warn().Err(err).Msg("[Reconciliation] Could not sum pending outgoing — omitting from liabilities")
	} else {
		total += pendingResult.Total
	}

	return total, summaries, nil
}

// checkAdditionalIssues performs additional consistency checks
func (rs *ReconciliationService) checkAdditionalIssues(report *ReconciliationReport) {
	// Check 1: Pending transactions
	var pendingCount int64
	if err := db.DB.Model(&models.PendingTransaction{}).
		Where("status = ?", "pending").
		Count(&pendingCount).Error; err == nil && pendingCount > 0 {
		report.Issues = append(report.Issues, ReconciliationIssue{
			Type:        "PENDING_TRANSACTIONS",
			Severity:    "WARNING",
			Description: fmt.Sprintf("Found %d pending transactions", pendingCount),
		})
	}

	// Check 2: Failed payout retries
	var failedRetries int64
	if err := db.DB.Model(&models.PayoutRetryQueue{}).
		Where("status = ?", "failed_permanent").
		Count(&failedRetries).Error; err == nil && failedRetries > 0 {
		report.Issues = append(report.Issues, ReconciliationIssue{
			Type:        "FAILED_PAYOUTS",
			Severity:    "WARNING",
			Description: fmt.Sprintf("Found %d permanently failed payouts requiring manual intervention", failedRetries),
		})
	}

	// Check 3: Payouts in retry queue
	var retryQueueCount int64
	if err := db.DB.Model(&models.PayoutRetryQueue{}).
		Where("status = ?", "pending").
		Count(&retryQueueCount).Error; err == nil && retryQueueCount > 10 {
		report.Issues = append(report.Issues, ReconciliationIssue{
			Type:        "RETRY_QUEUE_BACKLOG",
			Severity:    "WARNING",
			Description: fmt.Sprintf("Payout retry queue has %d pending items", retryQueueCount),
		})
	}

	// Check 4: Orphaned ledger entries (entries without corresponding transactions)
	// This is a simplified check - in production you'd do a more thorough analysis
	var orphanCount int64
	if err := db.DB.Raw(`
		SELECT COUNT(*) FROM wallet_ledger_entries e
		LEFT JOIN pending_transactions t ON e.reference_id = t.reference
		WHERE e.reference_id != '' AND t.id IS NULL
	`).Scan(&orphanCount).Error; err == nil && orphanCount > 0 {
		report.Issues = append(report.Issues, ReconciliationIssue{
			Type:        "ORPHANED_ENTRIES",
			Severity:    "INFO",
			Description: fmt.Sprintf("Found %d ledger entries without corresponding transactions", orphanCount),
		})
	}
}

// publishReport publishes the reconciliation report to NATS
func (rs *ReconciliationService) publishReport(ctx context.Context, report *ReconciliationReport) {
	// Publish to reconciliation channel
	nats.Publish(ctx, "proxy.treasury.v1.reconciliation", report)

	// If critical issues, also publish to alerts
	if report.Status == "DEFICIT" {
		nats.Publish(ctx, "proxy.telemetry.v1.alerts", map[string]interface{}{
			"type":        "reconciliation_deficit",
			"severity":    "CRITICAL",
			"message":     fmt.Sprintf("Treasury deficit detected: %.6f SOL", report.Discrepancy),
			"timestamp":   time.Now().UTC(),
			"report":      report,
		})
	}
}

// saveReport persists a reconciliation run result to the DB.
// P2-09: Called in the deferred cleanup of RunReconciliation.
func (rs *ReconciliationService) saveReport(report *ReconciliationReport, duration time.Duration) {
	issuesJSON := "[]"
	if len(report.Issues) > 0 {
		if data, err := json.Marshal(report.Issues); err == nil {
			issuesJSON = string(data)
		}
	}

	row := models.ReconciliationHistory{
		TreasuryBalanceSOL:     report.TreasuryBalance,
		InternalLiabilitiesSOL: report.InternalLiabilities,
		DiscrepancySOL:         report.Discrepancy,
		Status:                 report.Status,
		IssuesJSON:             issuesJSON,
		DurationMs:             duration.Milliseconds(),
	}
	if err := db.DB.Create(&row).Error; err != nil {
		logging.Error(err).Msg("[Reconciliation] Failed to persist report to DB")
	}
}

// GetLastReconciliationReport returns the most recent reconciliation report from DB.
// P2-09: Replaces the stub that always returned an error.
func (rs *ReconciliationService) GetLastReconciliationReport() (*ReconciliationReport, error) {
	var row models.ReconciliationHistory
	if err := db.DB.Order("created_at DESC").First(&row).Error; err != nil {
		return nil, fmt.Errorf("no reconciliation reports found: %w", err)
	}

	var issues []ReconciliationIssue
	if row.IssuesJSON != "" && row.IssuesJSON != "[]" {
		_ = json.Unmarshal([]byte(row.IssuesJSON), &issues)
	}
	if issues == nil {
		issues = []ReconciliationIssue{}
	}

	report := &ReconciliationReport{
		Timestamp:           row.CreatedAt,
		TreasuryBalance:     row.TreasuryBalanceSOL,
		InternalLiabilities: row.InternalLiabilitiesSOL,
		Discrepancy:         row.DiscrepancySOL,
		Status:              row.Status,
		Issues:              issues,
	}
	return report, nil
}

// abs returns the absolute value of a float64
func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

type ReconciliationDiscrepancy struct {
	ID            uuid.UUID `gorm:"column:id"`
	UserID        uuid.UUID `gorm:"column:user_id"`
	DBBalance     float64   `gorm:"column:db_balance"`
	LedgerBalance float64   `gorm:"column:ledger_balance"`
}

// ReconcileUserWallets compares the wallet's SOL balance against the sum of all ledger entries.
func (rs *ReconciliationService) ReconcileUserWallets(ctx context.Context) error {
	var discrepancies []ReconciliationDiscrepancy
	
	err := db.DB.Raw(`
		SELECT 
			w.id,
			w.user_id,
			w.balance_sol as db_balance,
			COALESCE(SUM(le.amount), 0) as ledger_balance
		FROM wallets w
		LEFT JOIN wallet_ledger_entries le ON w.id = le.wallet_id
		GROUP BY w.id, w.user_id, w.balance_sol
		HAVING w.balance_sol != COALESCE(SUM(le.amount), 0)
	`).Scan(&discrepancies).Error
	
	if err != nil {
		return err
	}

	for _, d := range discrepancies {
		msg := fmt.Sprintf("User: %s | Wallet: %s | DB Balance: %.6f SOL | Ledger Balance: %.6f SOL | Diff: %.6f SOL",
			d.UserID, d.ID, d.DBBalance, d.LedgerBalance, d.DBBalance-d.LedgerBalance)
		
		logging.Error(nil).
			Str("user_id", d.UserID.String()).
			Str("wallet_id", d.ID.String()).
			Float64("db_balance", d.DBBalance).
			Float64("ledger_balance", d.LedgerBalance).
			Msg("WALLET RECONCILIATION DISCREPANCY DETECTED")
		
		alerts.Send(alerts.Critical, "Wallet Balance Discrepancy", msg)
	}

	return nil
}
