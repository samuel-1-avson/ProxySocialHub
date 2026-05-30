// Package treasury - Treasury Management with Auto-Topup
package treasury

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/alerts"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/nats"
	"github.com/proxyhubb/control-api/internal/solana"
)

// TreasuryManager provides high-level treasury operations including auto-topup
// This addresses the critical issue of insufficient treasury balances
// and ensures continuous operation without manual intervention

// topupCooldown is the minimum interval between successive auto-topup attempts.
// P2-10: Prevents multiple concurrent topups when the check ticker fires while
// a previous transfer is still in flight or completing.
const topupCooldown = 10 * time.Minute

type TreasuryManager struct {
	watchtower       *Watchtower
	liquidityManager *LiquidityManager
	oracle           *solana.OracleClient

	// P2-10: Guards against concurrent or rapid-fire topup attempts.
	topupMu         sync.Mutex
	topupInProgress bool
	lastTopupAt     time.Time
}

// TreasuryThresholds contains balance thresholds for different environments
// Production values are significantly higher than devnet defaults

type TreasuryThresholds struct {
	// Critical minimum - trigger immediate alert and emergency topup
	MinSOLLamports uint64
	// Warning level - start standard topup process
	WarningSOLLamports uint64
	// Target level - maintain this balance
	TargetSOLLamports uint64
	// Reserve for large payouts - don't go below this
	ReserveSOLLamports uint64
}

// Environment-specific thresholds
var (
	// DevNetThresholds for development/testing
	DevNetThresholds = TreasuryThresholds{
		MinSOLLamports:     5 * solana.LamportsPerSOL,
		WarningSOLLamports: 10 * solana.LamportsPerSOL,
		TargetSOLLamports:  20 * solana.LamportsPerSOL,
		ReserveSOLLamports: 50 * solana.LamportsPerSOL,
	}

	// MainNetThresholds for production (100x higher)
	MainNetThresholds = TreasuryThresholds{
		MinSOLLamports:     100 * solana.LamportsPerSOL,  // ~$20,000 at $200/SOL
		WarningSOLLamports: 250 * solana.LamportsPerSOL, // ~$50,000
		TargetSOLLamports:  500 * solana.LamportsPerSOL, // ~$100,000
		ReserveSOLLamports: 1000 * solana.LamportsPerSOL, // ~$200,000
	}

	// StagingThresholds for pre-production testing
	StagingThresholds = TreasuryThresholds{
		MinSOLLamports:     50 * solana.LamportsPerSOL,
		WarningSOLLamports: 100 * solana.LamportsPerSOL,
		TargetSOLLamports:  200 * solana.LamportsPerSOL,
		ReserveSOLLamports: 500 * solana.LamportsPerSOL,
	}
)

// NewTreasuryManager creates a new treasury manager instance
func NewTreasuryManager() *TreasuryManager {
	return &TreasuryManager{
		watchtower:       NewWatchtower(),
		liquidityManager: NewLiquidityManager(solana.GetOracleClient()),
		oracle:           solana.GetOracleClient(),
	}
}

// GetThresholds returns appropriate thresholds based on environment
func (tm *TreasuryManager) GetThresholds() TreasuryThresholds {
	network := os.Getenv("SOLANA_NETWORK")
	if network == "mainnet-beta" {
		return MainNetThresholds
	}
	if network == "staging" {
		return StagingThresholds
	}
	return DevNetThresholds
}

// StartAutoTopupMonitor begins monitoring treasury balance and auto-topup
// This runs continuously to ensure treasury never runs dry
func (tm *TreasuryManager) StartAutoTopupMonitor(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Minute) // Check every 5 minutes
	defer ticker.Stop()

	// Initial check
	tm.checkAndTopup(ctx)

	for {
		select {
		case <-ctx.Done():
			logging.Info().Msg("Treasury auto-topup monitor shutting down")
			return
		case <-ticker.C:
			tm.checkAndTopup(ctx)
		}
	}
}

// checkAndTopup checks treasury balance and initiates topup if needed
func (tm *TreasuryManager) checkAndTopup(ctx context.Context) {
	if tm.oracle == nil {
		logging.Warn().Msg("Oracle client not available for treasury check")
		return
	}

	thresholds := tm.GetThresholds()
	treasuryAddr := tm.getTreasuryAddress()

	// Get current balance
	balance, err := tm.oracle.GetBalance(ctx, treasuryAddr)
	if err != nil {
		logging.Error(err).Msg("Failed to get treasury balance")
		tm.watchtower.RecordEconomicRisk(ctx, "Treasury balance check failed", "treasury")
		return
	}

	balanceSOL := solana.LamportsToSOL(balance)
	hotMinSOL := HotMinBalanceSOL()
	logging.Debug().
		Float64("balance_sol", balanceSOL).
		Float64("hot_min_sol", hotMinSOL).
		Float64("min_sol", float64(thresholds.MinSOLLamports)/1e9).
		Msg("Treasury balance check")

	if balanceSOL < hotMinSOL {
		cold := GetColdTreasuryPubkey()
		if !cold.IsZero() {
			logging.Warn().
				Float64("hot_balance_sol", balanceSOL).
				Float64("hot_min_sol", hotMinSOL).
				Float64("replenish_sol", HotReplenishAmountSOL()).
				Str("cold_address", cold.String()).
				Msg("Hot treasury below minimum — cold→hot replenish requires treasury multi-sig approval")
			tm.watchtower.TriggerAlert(ctx, "WARNING",
				"Hot treasury below minimum",
				fmt.Sprintf("%.4f SOL hot (min %.4f). Propose %.4f SOL cold→hot transfer via admin multi-sig.",
					balanceSOL, hotMinSOL, HotReplenishAmountSOL()))
		}
	}

	// Check against thresholds
	switch {
	case balance < thresholds.MinSOLLamports:
		// CRITICAL: Balance below minimum
		logging.Error(fmt.Errorf("treasury balance below minimum")).
			Float64("balance_sol", balanceSOL).
			Float64("min_sol", float64(thresholds.MinSOLLamports)/1e9).
			Msg("CRITICAL: Treasury balance below minimum threshold")

		tm.watchtower.RecordEconomicRisk(ctx,
			fmt.Sprintf("CRITICAL: Treasury balance %.4f SOL below minimum %.4f SOL",
				balanceSOL, float64(thresholds.MinSOLLamports)/1e9),
			"treasury")

		// Trigger emergency topup
		tm.triggerEmergencyTopup(ctx, balance, thresholds.TargetSOLLamports)

	case balance < thresholds.WarningSOLLamports:
		// WARNING: Balance below warning level
		logging.Warn().
			Float64("balance_sol", balanceSOL).
			Float64("warning_sol", float64(thresholds.WarningSOLLamports)/1e9).
			Msg("WARNING: Treasury balance below warning threshold")

		tm.watchtower.TriggerAlert(ctx, "WARNING",
			"Treasury balance low",
			fmt.Sprintf("%.4f SOL (warning at %.4f SOL)",
				balanceSOL, float64(thresholds.WarningSOLLamports)/1e9))

		// Trigger standard topup
		tm.triggerTopup(ctx, balance, thresholds.TargetSOLLamports)

	case balance < thresholds.TargetSOLLamports:
		// INFO: Balance below target but safe
		logging.Info().
			Float64("balance_sol", balanceSOL).
			Float64("target_sol", float64(thresholds.TargetSOLLamports)/1e9).
			Msg("Treasury balance below target, scheduled topup recommended")
	}
}

// triggerTopup initiates a standard topup from reserve wallet.
// P2-10: Skips if another topup is already in progress or if the cooldown
// period has not elapsed since the last attempt.
func (tm *TreasuryManager) triggerTopup(ctx context.Context, currentBalance, target uint64) {
	if currentBalance >= target {
		return
	}

	tm.topupMu.Lock()
	if tm.topupInProgress {
		tm.topupMu.Unlock()
		logging.Warn().Msg("Treasury topup skipped: another topup is already in progress")
		return
	}
	if !tm.lastTopupAt.IsZero() && time.Since(tm.lastTopupAt) < topupCooldown {
		tm.topupMu.Unlock()
		logging.Warn().
			Dur("cooldown_remaining", topupCooldown-time.Since(tm.lastTopupAt)).
			Msg("Treasury topup skipped: cooldown not elapsed")
		return
	}
	tm.topupInProgress = true
	tm.topupMu.Unlock()
	defer func() {
		tm.topupMu.Lock()
		tm.topupInProgress = false
		tm.lastTopupAt = time.Now()
		tm.topupMu.Unlock()
	}()

	amountNeeded := target - currentBalance
	amountSOL := solana.LamportsToSOL(amountNeeded)

	logging.Info().
		Float64("amount_sol", amountSOL).
		Msg("Initiating treasury topup")

	// Try to get reserve wallet key from environment
	reserveKeyPath := os.Getenv("SOLANA_RESERVE_KEYPAIR_PATH")
	if reserveKeyPath == "" {
		logging.Warn().Msg("No reserve keypair configured for auto-topup")
		tm.notifyManualTopupNeeded(amountSOL)
		return
	}

	// Attempt transfer from reserve
	// Note: In production, this should use a more secure mechanism
	// such as a dedicated treasury management contract
	err := tm.transferFromReserve(ctx, reserveKeyPath, amountNeeded)
	if err != nil {
		logging.Error(err).Msg("Auto-topup failed")
		tm.notifyManualTopupNeeded(amountSOL)
	} else {
		logging.Info().
			Float64("amount_sol", amountSOL).
			Msg("Treasury auto-topup completed successfully")

		// Publish event
		nats.Publish(ctx, "proxy.treasury.v1.topup", map[string]interface{}{
			"amount_sol":    amountSOL,
			"type":          "auto",
			"trigger":       "below_target",
			"new_balance":   solana.LamportsToSOL(target),
			"timestamp":     time.Now().UTC(),
		})
	}
}

// triggerEmergencyTopup initiates an emergency topup.
// P2-10: Shares the same in-progress guard; emergency calls bypass the cooldown.
func (tm *TreasuryManager) triggerEmergencyTopup(ctx context.Context, currentBalance, target uint64) {
	// Emergency topup: transfer larger amount to get well above minimum
	emergencyTarget := target * 2 // Double the target for safety
	if currentBalance >= emergencyTarget {
		return
	}

	tm.topupMu.Lock()
	if tm.topupInProgress {
		tm.topupMu.Unlock()
		logging.Warn().Msg("Emergency topup skipped: another topup is already in progress")
		return
	}
	tm.topupInProgress = true
	tm.topupMu.Unlock()
	defer func() {
		tm.topupMu.Lock()
		tm.topupInProgress = false
		tm.lastTopupAt = time.Now()
		tm.topupMu.Unlock()
	}()

	amountNeeded := emergencyTarget - currentBalance
	amountSOL := solana.LamportsToSOL(amountNeeded)

	logging.Error(fmt.Errorf("emergency treasury topup initiated")).
		Float64("amount_sol", amountSOL).
		Msg("EMERGENCY: Initiating emergency treasury topup")

	// Notify admins immediately
	tm.watchtower.TriggerAlert(ctx, "CRITICAL",
		"Emergency treasury topup triggered",
		fmt.Sprintf("Transferring %.4f SOL to treasury", amountSOL))

	// Attempt transfer
	reserveKeyPath := os.Getenv("SOLANA_RESERVE_KEYPAIR_PATH")
	if reserveKeyPath == "" {
		logging.Error(fmt.Errorf("no reserve keypair configured")).Msg("No reserve keypair configured - MANUAL INTERVENTION REQUIRED")
		tm.notifyManualTopupNeeded(amountSOL)
		return
	}

	err := tm.transferFromReserve(ctx, reserveKeyPath, amountNeeded)
	if err != nil {
		logging.Error(err).Msg("Emergency auto-topup failed - MANUAL INTERVENTION REQUIRED")
		tm.notifyManualTopupNeeded(amountSOL)
	} else {
		logging.Info().
			Float64("amount_sol", amountSOL).
			Msg("Emergency treasury topup completed")

		nats.Publish(ctx, "proxy.treasury.v1.topup", map[string]interface{}{
			"amount_sol":  amountSOL,
			"type":        "emergency",
			"trigger":     "below_minimum",
			"timestamp":   time.Now().UTC(),
		})
	}
}

// transferFromReserve attempts to transfer SOL from reserve wallet to treasury
func (tm *TreasuryManager) transferFromReserve(ctx context.Context, reserveKeyPath string, amount uint64) error {
	// Load reserve keypair
	reserveKey, err := solana.LoadKeypairFromFile(reserveKeyPath)
	if err != nil {
		return fmt.Errorf("failed to load reserve keypair: %w", err)
	}

	treasuryAddr := tm.getTreasuryAddress()

	// Check reserve balance
	reserveBalance, err := tm.oracle.GetBalance(ctx, reserveKey.PublicKey())
	if err != nil {
		return fmt.Errorf("failed to check reserve balance: %w", err)
	}

	if reserveBalance < amount+5000 { // Account for transaction fee
		return fmt.Errorf("insufficient reserve balance: %d lamports", reserveBalance)
	}

	// Build and send transfer transaction
	// This is a simple direct transfer - in production, consider using
	// a more sophisticated treasury management contract
	txHash, err := tm.oracle.SendSOL(ctx, treasuryAddr, amount)
	if err != nil {
		return fmt.Errorf("transfer failed: %w", err)
	}

	logging.Info().
		Str("tx_hash", txHash).
		Uint64("amount_lamports", amount).
		Msg("Reserve to treasury transfer completed")

	return nil
}

// notifyManualTopupNeeded sends notification for manual topup.
// P1-13: Delivers alert via configured channels (Slack/email) in addition to logging.
func (tm *TreasuryManager) notifyManualTopupNeeded(amountSOL float64) {
	addr := tm.getTreasuryAddress().String()
	logging.Error(fmt.Errorf("manual topup required")).
		Float64("amount_sol_needed", amountSOL).
		Str("treasury_address", addr).
		Msg("MANUAL TOPUP REQUIRED")

	alerts.Send(alerts.Critical, "Treasury Manual Topup Required",
		fmt.Sprintf("Auto-topup failed. Manual transfer of %.4f SOL required to treasury %s", amountSOL, addr))
}

// getTreasuryAddress returns the hot operational treasury address.
func (tm *TreasuryManager) getTreasuryAddress() sol.PublicKey {
	if pk := GetHotTreasuryPubkey(); !pk.IsZero() {
		return pk
	}
	if tm.oracle != nil {
		return tm.oracle.GetOraclePublicKey()
	}
	return sol.PublicKey{}
}

// GetTreasuryStats returns current treasury statistics (hot + optional cold).
func (tm *TreasuryManager) GetTreasuryStats(ctx context.Context) (*TreasuryStats, error) {
	if tm.oracle == nil {
		return nil, fmt.Errorf("oracle not available")
	}

	hotAddr := tm.getTreasuryAddress()
	hotBalance, err := tm.oracle.GetBalance(ctx, hotAddr)
	if err != nil {
		return nil, err
	}

	thresholds := tm.GetThresholds()
	hotMinLamports := uint64(HotMinBalanceSOL() * float64(solana.LamportsPerSOL))

	stats := &TreasuryStats{
		Address:         hotAddr.String(),
		BalanceLamports: hotBalance,
		BalanceSOL:      solana.LamportsToSOL(hotBalance),
		Hot: WalletBalanceView{
			Address:         hotAddr.String(),
			BalanceLamports: hotBalance,
			BalanceSOL:      solana.LamportsToSOL(hotBalance),
			MinBalanceSOL:   HotMinBalanceSOL(),
			MaxBalanceSOL:   HotMaxBalanceSOL(),
			ReplenishSOL:    HotReplenishAmountSOL(),
			NeedsReplenish:  hotBalance < hotMinLamports,
		},
		Thresholds:    thresholds,
		Status:        tm.getTreasuryStatus(hotBalance, thresholds),
		LastCheckedAt: time.Now().UTC(),
	}

	coldAddr := GetColdTreasuryPubkey()
	if !coldAddr.IsZero() {
		coldBalance, coldErr := tm.oracle.GetBalance(ctx, coldAddr)
		if coldErr == nil {
			stats.Cold = &WalletBalanceView{
				Address:         coldAddr.String(),
				BalanceLamports: coldBalance,
				BalanceSOL:      solana.LamportsToSOL(coldBalance),
			}
			stats.CombinedBalanceSOL = stats.Hot.BalanceSOL + stats.Cold.BalanceSOL
			stats.CombinedBalanceLamports = hotBalance + coldBalance
		}
	} else {
		stats.CombinedBalanceSOL = stats.Hot.BalanceSOL
		stats.CombinedBalanceLamports = hotBalance
	}

	return stats, nil
}

// WalletBalanceView is a single treasury wallet balance snapshot.
type WalletBalanceView struct {
	Address         string  `json:"address"`
	BalanceLamports uint64  `json:"balance_lamports"`
	BalanceSOL      float64 `json:"balance_sol"`
	MinBalanceSOL   float64 `json:"min_balance_sol,omitempty"`
	MaxBalanceSOL   float64 `json:"max_balance_sol,omitempty"`
	ReplenishSOL    float64 `json:"replenish_sol,omitempty"`
	NeedsReplenish  bool    `json:"needs_replenish,omitempty"`
}

// TreasuryStats represents treasury statistics
type TreasuryStats struct {
	Address         string             `json:"address"`
	BalanceLamports uint64             `json:"balance_lamports"`
	BalanceSOL      float64            `json:"balance_sol"`
	Hot             WalletBalanceView  `json:"hot"`
	Cold            *WalletBalanceView `json:"cold,omitempty"`
	CombinedBalanceLamports uint64     `json:"combined_balance_lamports"`
	CombinedBalanceSOL      float64    `json:"combined_balance_sol"`
	Thresholds      TreasuryThresholds `json:"thresholds"`
	Status          string             `json:"status"`
	LastCheckedAt   time.Time          `json:"last_checked_at"`
}

// getTreasuryStatus returns the status based on balance
func (tm *TreasuryManager) getTreasuryStatus(balance uint64, thresholds TreasuryThresholds) string {
	switch {
	case balance < thresholds.MinSOLLamports:
		return "CRITICAL"
	case balance < thresholds.WarningSOLLamports:
		return "WARNING"
	case balance < thresholds.TargetSOLLamports:
		return "BELOW_TARGET"
	default:
		return "HEALTHY"
	}
}

// RecordOutgoingTransfer records an outgoing transfer for velocity monitoring
func (tm *TreasuryManager) RecordOutgoingTransfer(ctx context.Context, amountSOL float64) error {
	return tm.watchtower.RecordOutflow(ctx, amountSOL)
}
