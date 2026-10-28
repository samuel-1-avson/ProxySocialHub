package treasury

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/alerts"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/nats"
	"github.com/proxyhubb/control-api/internal/solana"
)

// TreasuryManager provides high-level treasury operations including auto-topup.
// This addresses the critical issue of insufficient treasury balances
// and ensures continuous operation without manual intervention.

// topupCooldown is the minimum interval between successive auto-topup attempts.
// P2-10: Prevents multiple concurrent topups when the check ticker fires while
// a previous transfer is still in flight or completing.
const topupCooldown = 10 * time.Minute

// Adaptive monitor intervals.
const (
	monitorIntervalHealthy  = 5 * time.Minute
	monitorIntervalReplenish = 60 * time.Second
)

type TreasuryManager struct {
	watchtower       *Watchtower
	liquidityManager *LiquidityManager
	oracle           *solana.OracleClient

	// P2-10: Guards against concurrent or rapid-fire topup attempts.
	topupMu         sync.Mutex
	topupInProgress bool
	lastTopupAt     time.Time
	lastTopupTx     string
	lastTopupSOL    float64
	lastTopupSource string // "vault" | "reserve"

	// Cold→hot / hot→cold proposal dedupe (system-initiated).
	coldProposeMu   sync.Mutex
	lastColdPropose time.Time
	sweepProposeMu  sync.Mutex
	lastSweepPropose time.Time
}

var (
	managerOnce sync.Once
	managerInst *TreasuryManager

	payoutDrainNotify = make(chan struct{}, 1)
)

// GetManager returns the process-wide TreasuryManager singleton.
func GetManager() *TreasuryManager {
	managerOnce.Do(func() {
		managerInst = NewTreasuryManager()
	})
	return managerInst
}

// NotifyPayoutDrain wakes the withdrawal payout worker (non-blocking).
func NotifyPayoutDrain() {
	select {
	case payoutDrainNotify <- struct{}{}:
	default:
	}
}

// PayoutDrainNotify is the channel the payout worker selects on.
func PayoutDrainNotify() <-chan struct{} {
	return payoutDrainNotify
}

// TreasuryThresholds contains balance thresholds for different environments.
// Production values are significantly higher than devnet defaults.
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
	// DevNetThresholds for local development/testing (small capital).
	DevNetThresholds = TreasuryThresholds{
		MinSOLLamports:     1 * solana.LamportsPerSOL / 10, // 0.1 SOL
		WarningSOLLamports: 1 * solana.LamportsPerSOL,
		TargetSOLLamports:  2 * solana.LamportsPerSOL,
		ReserveSOLLamports: 5 * solana.LamportsPerSOL,
	}

	// MainNetThresholds for production.
	MainNetThresholds = TreasuryThresholds{
		MinSOLLamports:     100 * solana.LamportsPerSOL,
		WarningSOLLamports: 250 * solana.LamportsPerSOL,
		TargetSOLLamports:  500 * solana.LamportsPerSOL,
		ReserveSOLLamports: 1000 * solana.LamportsPerSOL,
	}

	// StagingThresholds for pre-production / GCP testnet capital.
	StagingThresholds = TreasuryThresholds{
		MinSOLLamports:     5 * solana.LamportsPerSOL,
		WarningSOLLamports: 10 * solana.LamportsPerSOL,
		TargetSOLLamports:  20 * solana.LamportsPerSOL,
		ReserveSOLLamports: 50 * solana.LamportsPerSOL,
	}
)

// NewTreasuryManager creates a new treasury manager instance.
func NewTreasuryManager() *TreasuryManager {
	return &TreasuryManager{
		watchtower:       NewWatchtower(),
		liquidityManager: NewLiquidityManager(solana.GetOracleClient()),
		// Prefer live GetOracleClient() via oracleClient() — KMS oracle is often
		// RegisterOracleClient'd after GetManager() on gcp-testnet.
		oracle: solana.GetOracleClient(),
	}
}

// oracleClient returns the live Solana client. Do not rely solely on the
// pointer captured at NewTreasuryManager — RegisterOracleClient may run later.
func (tm *TreasuryManager) oracleClient() *solana.OracleClient {
	if c := solana.GetOracleClient(); c != nil {
		return c
	}
	return tm.oracle
}

// RefreshOracle rebinds after RegisterOracleClient (startup ordering).
func (tm *TreasuryManager) RefreshOracle() {
	tm.oracle = solana.GetOracleClient()
}

// GetThresholds returns appropriate thresholds based on environment.
func (tm *TreasuryManager) GetThresholds() TreasuryThresholds {
	network := strings.ToLower(strings.TrimSpace(os.Getenv("SOLANA_NETWORK")))
	appEnv := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if network == "mainnet-beta" || network == "mainnet" || appEnv == "production" || appEnv == "prod" {
		return MainNetThresholds
	}
	if network == "staging" || appEnv == "staging" {
		return StagingThresholds
	}
	return DevNetThresholds
}

// StartAutoTopupMonitor begins monitoring treasury balance and auto-topup.
// Interval shortens to ~60s while hot needs replenish.
func (tm *TreasuryManager) StartAutoTopupMonitor(ctx context.Context) {
	interval := monitorIntervalHealthy
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	tm.checkAndTopup(ctx)

	for {
		select {
		case <-ctx.Done():
			logging.Info().Msg("Treasury auto-topup monitor shutting down")
			return
		case <-ticker.C:
			needs := tm.checkAndTopup(ctx)
			next := monitorIntervalHealthy
			if needs {
				next = monitorIntervalReplenish
			}
			if next != interval {
				ticker.Reset(next)
				interval = next
			}
		}
	}
}

// checkAndTopup checks treasury balance and initiates topup if needed.
// Returns true when hot still needs replenish after this pass.
func (tm *TreasuryManager) checkAndTopup(ctx context.Context) bool {
	oracle := tm.oracleClient()
	if oracle == nil {
		logging.Warn().Msg("Oracle client not available for treasury check")
		return false
	}

	thresholds := tm.GetThresholds()
	treasuryAddr := tm.getTreasuryAddress()

	balance, err := oracle.GetBalance(ctx, treasuryAddr)
	if err != nil {
		logging.Error(err).Msg("Failed to get treasury balance")
		tm.watchtower.RecordEconomicRisk(ctx, "Treasury balance check failed", "treasury")
		return false
	}

	balanceSOL := solana.LamportsToSOL(balance)
	hotMinSOL := HotMinBalanceSOL()
	logging.Debug().
		Float64("balance_sol", balanceSOL).
		Float64("hot_min_sol", hotMinSOL).
		Float64("min_sol", float64(thresholds.MinSOLLamports)/1e9).
		Msg("Treasury balance check")

	needsReplenish := balanceSOL < hotMinSOL
	if needsReplenish {
		needSOL := hotMinSOL - balanceSOL
		if needSOL < HotReplenishAmountSOL() {
			needSOL = HotReplenishAmountSOL()
		}
		txHash, topErr := tm.TopUpHotFromVault(ctx, needSOL)
		if topErr != nil {
			logging.Warn().Err(topErr).Float64("need_sol", needSOL).Msg("Vault→hot top-up skipped or failed")
			tm.ProposeColdToHotIfNeeded(ctx, needSOL, topErr.Error())
		} else if txHash != "" {
			logging.Info().Str("tx_hash", txHash).Float64("amount_sol", needSOL).Msg("Vault→hot top-up submitted")
			NotifyPayoutDrain()
		}
	} else if sweep := ExcessHotSweepSOL(balanceSOL, HotMaxBalanceSOL()); sweep > 0 {
		tm.ProposeHotToColdSweepIfNeeded(ctx, sweep)
	}

	switch {
	case balance < thresholds.MinSOLLamports:
		logging.Error(fmt.Errorf("treasury balance below minimum")).
			Float64("balance_sol", balanceSOL).
			Float64("min_sol", float64(thresholds.MinSOLLamports)/1e9).
			Msg("CRITICAL: Treasury balance below minimum threshold")

		tm.watchtower.RecordEconomicRisk(ctx,
			fmt.Sprintf("CRITICAL: Treasury balance %.4f SOL below minimum %.4f SOL",
				balanceSOL, float64(thresholds.MinSOLLamports)/1e9),
			"treasury")

		tm.triggerEmergencyTopup(ctx, balance, thresholds.TargetSOLLamports)

	case balance < thresholds.WarningSOLLamports:
		logging.Warn().
			Float64("balance_sol", balanceSOL).
			Float64("warning_sol", float64(thresholds.WarningSOLLamports)/1e9).
			Msg("WARNING: Treasury balance below warning threshold")

		tm.watchtower.TriggerAlert(ctx, "WARNING",
			"Treasury balance low",
			fmt.Sprintf("%.4f SOL (warning at %.4f SOL)",
				balanceSOL, float64(thresholds.WarningSOLLamports)/1e9))

		tm.triggerTopup(ctx, balance, thresholds.TargetSOLLamports)

	case balance < thresholds.TargetSOLLamports:
		logging.Info().
			Float64("balance_sol", balanceSOL).
			Float64("target_sol", float64(thresholds.TargetSOLLamports)/1e9).
			Msg("Treasury balance below target, scheduled topup recommended")
	}

	if bal, err := tm.oracleClient().GetBalance(ctx, treasuryAddr); err == nil {
		return solana.LamportsToSOL(bal) < hotMinSOL
	}
	return needsReplenish
}

// EnsureHotLiquidity attempts an immediate vault→hot top-up so hot can cover needLamports.
// Used by withdraw preflight (event-driven, not only the poller).
func (tm *TreasuryManager) EnsureHotLiquidity(ctx context.Context, needLamports uint64) (string, error) {
	if tm.oracleClient() == nil {
		return "", fmt.Errorf("oracle not configured")
	}
	hot := tm.getTreasuryAddress()
	bal, err := tm.oracleClient().GetBalance(ctx, hot)
	if err != nil {
		return "", err
	}
	if bal >= needLamports {
		return "", nil
	}
	shortfall := solana.LamportsToSOL(needLamports - bal)
	needSOL := shortfall
	if needSOL < HotReplenishAmountSOL() {
		needSOL = HotReplenishAmountSOL()
	}
	txHash, err := tm.TopUpHotFromVault(ctx, needSOL)
	if err != nil {
		tm.ProposeColdToHotIfNeeded(ctx, needSOL, err.Error())
		return "", err
	}
	if txHash != "" {
		NotifyPayoutDrain()
	}
	return txHash, nil
}

// ProposeColdToHotIfNeeded creates a multi-sig cold→hot proposal + ops alerts when
// vault cannot refill hot. Deduped to at most once per 15 minutes.
func (tm *TreasuryManager) ProposeColdToHotIfNeeded(ctx context.Context, amountSOL float64, reason string) {
	cold := GetColdTreasuryPubkey()
	hot := tm.getTreasuryAddress()
	if cold.IsZero() || hot.IsZero() {
		tm.watchtower.TriggerAlert(ctx, "CRITICAL",
			"Hot treasury underfunded — vault empty and no cold wallet configured",
			fmt.Sprintf("need %.4f SOL; reason: %s", amountSOL, reason))
		alerts.Send(alerts.Critical, "Treasury Cold→Hot Needed",
			fmt.Sprintf("Vault cannot refill hot (%.4f SOL). No cold address configured. Reason: %s", amountSOL, reason))
		return
	}

	tm.coldProposeMu.Lock()
	if !tm.lastColdPropose.IsZero() && time.Since(tm.lastColdPropose) < 15*time.Minute {
		tm.coldProposeMu.Unlock()
		return
	}
	tm.lastColdPropose = time.Now()
	tm.coldProposeMu.Unlock()

	if amountSOL < HotReplenishAmountSOL() {
		amountSOL = HotReplenishAmountSOL()
	}

	actionID, err := proposeColdToHot(amountSOL, hot.String())
	deepLink := "/v1/treasury/withdrawals/pending"
	if err != nil {
		logging.Warn().Err(err).Msg("Failed to create cold→hot multi-sig proposal")
	} else if actionID != "" {
		deepLink = "/v1/treasury/withdrawals/" + actionID
	}

	msg := fmt.Sprintf(
		"Hot underfunded; vault cannot cover %.4f SOL. Propose cold→hot from %s to %s. Approval: %s. Reason: %s. Ops script: scripts/gcp-topup-hot-from-cold.sh",
		amountSOL, cold.String(), hot.String(), deepLink, reason)

	logging.Warn().
		Float64("amount_sol", amountSOL).
		Str("cold", cold.String()).
		Str("hot", hot.String()).
		Str("action_id", actionID).
		Msg("Cold→hot multi-sig proposal required")

	tm.watchtower.TriggerAlert(ctx, "CRITICAL", "Cold→hot multi-sig required", msg)
	alerts.Send(alerts.Critical, "Treasury Cold→Hot Multi-Sig Required", msg)
}

// proposeColdToHot is wired from main via SetColdToHotProposer (avoids gov↔treasury import cycle).
var proposeColdToHot = func(amountSOL float64, hotAddress string) (string, error) {
	return "", fmt.Errorf("cold→hot proposer not configured")
}

// SetColdToHotProposer registers the multi-sig proposal backend.
func SetColdToHotProposer(fn func(amountSOL float64, hotAddress string) (actionID string, err error)) {
	if fn != nil {
		proposeColdToHot = fn
	}
}

// proposeHotToCold is wired from main via SetHotToColdProposer.
var proposeHotToCold = func(amountSOL float64, coldAddress string) (string, error) {
	return "", fmt.Errorf("hot→cold proposer not configured")
}

// SetHotToColdProposer registers the multi-sig hot→cold sweep proposal backend.
func SetHotToColdProposer(fn func(amountSOL float64, coldAddress string) (actionID string, err error)) {
	if fn != nil {
		proposeHotToCold = fn
	}
}

// ProposeHotToColdSweepIfNeeded opens a multi-sig proposal to move excess hot→cold.
// Deduped to at most once per 15 minutes. Does not move funds until admins approve.
func (tm *TreasuryManager) ProposeHotToColdSweepIfNeeded(ctx context.Context, amountSOL float64) {
	if !SweepEnabled() {
		return
	}
	cold := GetColdTreasuryPubkey()
	if cold.IsZero() {
		logging.Warn().Float64("excess_sol", amountSOL).Msg("Hot above max but cold wallet not configured — skip sweep proposal")
		tm.watchtower.TriggerAlert(ctx, "WARNING",
			"Hot treasury above max — cold not configured",
			fmt.Sprintf("hot excess %.4f SOL; configure SOLANA_TREASURY_COLD_ADDRESS for sweeps", amountSOL))
		return
	}

	tm.sweepProposeMu.Lock()
	if !tm.lastSweepPropose.IsZero() && time.Since(tm.lastSweepPropose) < 15*time.Minute {
		tm.sweepProposeMu.Unlock()
		return
	}
	tm.lastSweepPropose = time.Now()
	tm.sweepProposeMu.Unlock()

	actionID, err := proposeHotToCold(amountSOL, cold.String())
	deepLink := "/v1/treasury/withdrawals/pending"
	if err != nil {
		logging.Warn().Err(err).Msg("Failed to create hot→cold sweep multi-sig proposal")
	} else if actionID != "" {
		deepLink = "/v1/treasury/withdrawals/" + actionID
	}

	msg := fmt.Sprintf(
		"Hot above max (%.4f SOL excess). Propose sweep hot→cold %s. Approval: %s",
		amountSOL, cold.String(), deepLink)

	logging.Warn().
		Float64("amount_sol", amountSOL).
		Str("cold", cold.String()).
		Str("action_id", actionID).
		Msg("Hot→cold sweep multi-sig proposal required")

	tm.watchtower.TriggerAlert(ctx, "WARNING", "Hot→cold sweep multi-sig required", msg)
	alerts.Send(alerts.Warning, "Treasury Hot→Cold Sweep Required", msg)
}

// LastTopUpSnapshot returns the most recent vault/reserve top-up metadata.
func (tm *TreasuryManager) LastTopUpSnapshot() (at time.Time, txHash string, amountSOL float64, source string) {
	tm.topupMu.Lock()
	defer tm.topupMu.Unlock()
	return tm.lastTopupAt, tm.lastTopupTx, tm.lastTopupSOL, tm.lastTopupSource
}

func (tm *TreasuryManager) recordTopUp(txHash string, amountSOL float64, source string) {
	tm.topupMu.Lock()
	defer tm.topupMu.Unlock()
	tm.lastTopupAt = time.Now().UTC()
	tm.lastTopupTx = txHash
	tm.lastTopupSOL = amountSOL
	tm.lastTopupSource = source
}

// triggerTopup initiates a standard topup from reserve wallet.
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
		tm.topupMu.Unlock()
	}()

	amountNeeded := target - currentBalance
	amountSOL := solana.LamportsToSOL(amountNeeded)

	logging.Info().
		Float64("amount_sol", amountSOL).
		Msg("Initiating treasury topup")

	reserveKeyPath := os.Getenv("SOLANA_RESERVE_KEYPAIR_PATH")
	if reserveKeyPath == "" {
		logging.Warn().Msg("No reserve keypair configured for auto-topup")
		tm.notifyManualTopupNeeded(amountSOL)
		return
	}

	err := tm.transferFromReserve(ctx, reserveKeyPath, amountNeeded)
	if err != nil {
		logging.Error(err).Msg("Auto-topup failed")
		tm.notifyManualTopupNeeded(amountSOL)
	} else {
		logging.Info().
			Float64("amount_sol", amountSOL).
			Msg("Treasury auto-topup completed successfully")

		nats.Publish(ctx, "proxy.treasury.v1.topup", map[string]interface{}{
			"amount_sol":  amountSOL,
			"type":        "auto",
			"trigger":     "below_target",
			"new_balance": solana.LamportsToSOL(target),
			"timestamp":   time.Now().UTC(),
		})
		NotifyPayoutDrain()
	}
}

// triggerEmergencyTopup initiates an emergency topup.
func (tm *TreasuryManager) triggerEmergencyTopup(ctx context.Context, currentBalance, target uint64) {
	emergencyTarget := target * 2
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
		tm.topupMu.Unlock()
	}()

	amountNeeded := emergencyTarget - currentBalance
	amountSOL := solana.LamportsToSOL(amountNeeded)

	logging.Error(fmt.Errorf("emergency treasury topup initiated")).
		Float64("amount_sol", amountSOL).
		Msg("EMERGENCY: Initiating emergency treasury topup")

	tm.watchtower.TriggerAlert(ctx, "CRITICAL",
		"Emergency treasury topup triggered",
		fmt.Sprintf("Transferring %.4f SOL to treasury", amountSOL))

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
			"amount_sol": amountSOL,
			"type":       "emergency",
			"trigger":    "below_minimum",
			"timestamp":  time.Now().UTC(),
		})
		NotifyPayoutDrain()
	}
}

func (tm *TreasuryManager) transferFromReserve(ctx context.Context, reserveKeyPath string, amount uint64) error {
	reserveKey, err := solana.LoadKeypairFromFile(reserveKeyPath)
	if err != nil {
		return fmt.Errorf("failed to load reserve keypair: %w", err)
	}

	treasuryAddr := tm.getTreasuryAddress()

	reserveBalance, err := tm.oracleClient().GetBalance(ctx, reserveKey.PublicKey())
	if err != nil {
		return fmt.Errorf("failed to check reserve balance: %w", err)
	}

	if reserveBalance < amount+5000 {
		return fmt.Errorf("insufficient reserve balance: %d lamports", reserveBalance)
	}

	// Sign with the reserve key. SendSOL signs with the hot treasury wallet, which
	// here would send treasuryAddr's own funds back to treasuryAddr (BE-CRIT-05).
	txHash, err := tm.oracleClient().SendSOLFrom(ctx, reserveKey, treasuryAddr, amount)
	if err != nil {
		return fmt.Errorf("transfer failed: %w", err)
	}

	tm.recordTopUp(txHash, solana.LamportsToSOL(amount), "reserve")

	logging.Info().
		Str("tx_hash", txHash).
		Uint64("amount_lamports", amount).
		Msg("Reserve to treasury transfer completed")

	return nil
}

func (tm *TreasuryManager) notifyManualTopupNeeded(amountSOL float64) {
	addr := tm.getTreasuryAddress().String()
	logging.Error(fmt.Errorf("manual topup required")).
		Float64("amount_sol_needed", amountSOL).
		Str("treasury_address", addr).
		Msg("MANUAL TOPUP REQUIRED")

	alerts.Send(alerts.Critical, "Treasury Manual Topup Required",
		fmt.Sprintf("Auto-topup failed. Manual transfer of %.4f SOL required to treasury %s", amountSOL, addr))
}

// TopUpHotFromVault withdraws SOL from the deposit vault PDA into the bound hot treasury.
// Applies per-tx max, vault reserve floor, and daily caps.
func (tm *TreasuryManager) TopUpHotFromVault(ctx context.Context, amountSOL float64) (string, error) {
	if tm.oracleClient() == nil {
		return "", fmt.Errorf("oracle not configured")
	}
	vaultPK := GetDepositVaultPubkey()
	if vaultPK.IsZero() {
		return "", fmt.Errorf("deposit vault not configured")
	}
	if amountSOL <= 0 {
		return "", fmt.Errorf("amount must be positive")
	}

	cappedSOL, err := CapVaultTopUpAmount(ctx, amountSOL)
	if err != nil {
		return "", err
	}

	bal, err := tm.oracleClient().GetBalance(ctx, vaultPK)
	if err != nil {
		return "", fmt.Errorf("vault balance: %w", err)
	}

	reserveLamports := uint64(VaultReserveFloorSOL() * float64(solana.LamportsPerSOL))
	if reserveLamports < 2_000_000 {
		reserveLamports = 2_000_000 // rent-exempt margin floor
	}
	available := uint64(0)
	if bal > reserveLamports {
		available = bal - reserveLamports
	}
	if available == 0 {
		return "", fmt.Errorf("vault has no withdrawable balance above reserve floor")
	}

	need := uint64(cappedSOL * float64(solana.LamportsPerSOL))
	if need > available {
		need = available
	}
	if need == 0 {
		return "", fmt.Errorf("vault top-up amount rounds to zero")
	}

	hot := tm.getTreasuryAddress()
	txHash, err := tm.oracleClient().WithdrawFromVault(ctx, solana.WithdrawFromVaultParams{
		AmountLamports: need,
		HotTreasury:    hot,
	})
	if err != nil {
		return "", err
	}

	movedSOL := solana.LamportsToSOL(need)
	RecordVaultTopUpSOL(ctx, movedSOL)
	tm.recordTopUp(txHash, movedSOL, "vault")

	nats.Publish(ctx, "proxy.treasury.v1.topup", map[string]interface{}{
		"amount_sol": movedSOL,
		"type":       "vault",
		"tx_hash":    txHash,
		"timestamp":  time.Now().UTC(),
	})

	return txHash, nil
}

func (tm *TreasuryManager) getTreasuryAddress() sol.PublicKey {
	if pk := GetHotTreasuryPubkey(); !pk.IsZero() {
		return pk
	}
	if tm.oracleClient() != nil {
		return tm.oracleClient().GetOraclePublicKey()
	}
	return sol.PublicKey{}
}

// LiquidityMetrics are queue/top-up signals for transparency + ops.
type LiquidityMetrics struct {
	QueueDepth             int64      `json:"queue_depth"`
	QueueOldestAgeSecs     int64      `json:"queue_oldest_age_secs,omitempty"`
	LastTopUpAt            *time.Time `json:"last_topup_at,omitempty"`
	LastTopUpTx            string     `json:"last_topup_tx,omitempty"`
	LastTopUpSOL           float64    `json:"last_topup_sol,omitempty"`
	LastTopUpSource        string     `json:"last_topup_source,omitempty"`
	VaultDailyRemainingSOL float64    `json:"vault_daily_remaining_sol"`
	VaultTopUpMaxSOL       float64    `json:"vault_topup_max_sol"`
	VaultReserveFloorSOL   float64    `json:"vault_reserve_floor_sol"`
	SweepEnabled           bool       `json:"sweep_enabled"`
	HotMaxSOL              float64    `json:"hot_max_sol"`
}

// GetTreasuryStats returns current treasury statistics (hot + optional cold + vault).
func (tm *TreasuryManager) GetTreasuryStats(ctx context.Context) (*TreasuryStats, error) {
	hotAddr := tm.getTreasuryAddress()
	if hotAddr.IsZero() {
		return nil, fmt.Errorf("treasury hot address not configured")
	}

	thresholds := tm.GetThresholds()
	hotMinLamports := uint64(HotMinBalanceSOL() * float64(solana.LamportsPerSOL))

	stats := &TreasuryStats{
		Address: hotAddr.String(),
		Hot: WalletBalanceView{
			Address:       hotAddr.String(),
			MinBalanceSOL: HotMinBalanceSOL(),
			MaxBalanceSOL: HotMaxBalanceSOL(),
			ReplenishSOL:  HotReplenishAmountSOL(),
		},
		Thresholds:    thresholds,
		LastCheckedAt: time.Now().UTC(),
	}

	var hotBalance uint64
	if tm.oracleClient() == nil {
		stats.Status = "RPC_UNAVAILABLE"
		stats.Hot.BalanceUnavailable = true
	} else if bal, err := tm.oracleClient().GetBalance(ctx, hotAddr); err != nil {
		stats.Status = "RPC_UNAVAILABLE"
		stats.Hot.BalanceUnavailable = true
	} else {
		hotBalance = bal
		stats.BalanceLamports = hotBalance
		stats.BalanceSOL = solana.LamportsToSOL(hotBalance)
		stats.Hot.BalanceLamports = hotBalance
		stats.Hot.BalanceSOL = solana.LamportsToSOL(hotBalance)
		stats.Hot.NeedsReplenish = hotBalance < hotMinLamports
		stats.Status = tm.getTreasuryStatus(hotBalance, thresholds)
	}

	coldAddr := GetColdTreasuryPubkey()
	if !coldAddr.IsZero() {
		coldView := &WalletBalanceView{Address: coldAddr.String()}
		if tm.oracleClient() != nil {
			if coldBalance, coldErr := tm.oracleClient().GetBalance(ctx, coldAddr); coldErr == nil {
				coldView.BalanceLamports = coldBalance
				coldView.BalanceSOL = solana.LamportsToSOL(coldBalance)
				stats.CombinedBalanceSOL = stats.Hot.BalanceSOL + coldView.BalanceSOL
				stats.CombinedBalanceLamports = hotBalance + coldBalance
			} else {
				coldView.BalanceUnavailable = true
				stats.CombinedBalanceSOL = stats.Hot.BalanceSOL
				stats.CombinedBalanceLamports = hotBalance
			}
		} else {
			coldView.BalanceUnavailable = true
			stats.CombinedBalanceSOL = stats.Hot.BalanceSOL
			stats.CombinedBalanceLamports = hotBalance
		}
		stats.Cold = coldView
	} else {
		stats.CombinedBalanceSOL = stats.Hot.BalanceSOL
		stats.CombinedBalanceLamports = hotBalance
	}

	vaultAddr := GetDepositVaultPubkey()
	if !vaultAddr.IsZero() {
		vaultView := &WalletBalanceView{Address: vaultAddr.String()}
		if tm.oracleClient() != nil {
			if vaultBal, vaultErr := tm.oracleClient().GetBalance(ctx, vaultAddr); vaultErr == nil {
				vaultView.BalanceLamports = vaultBal
				vaultView.BalanceSOL = solana.LamportsToSOL(vaultBal)
				stats.CombinedBalanceSOL += vaultView.BalanceSOL
				stats.CombinedBalanceLamports += vaultBal
			} else {
				vaultView.BalanceUnavailable = true
			}
		} else {
			vaultView.BalanceUnavailable = true
		}
		stats.Vault = vaultView
	}

	stats.Liquidity = tm.buildLiquidityMetrics(ctx)
	return stats, nil
}

func (tm *TreasuryManager) buildLiquidityMetrics(ctx context.Context) *LiquidityMetrics {
	m := &LiquidityMetrics{
		VaultDailyRemainingSOL: RemainingVaultDailyTopUpSOL(ctx),
		VaultTopUpMaxSOL:       VaultTopUpMaxSOL(),
		VaultReserveFloorSOL:   VaultReserveFloorSOL(),
		SweepEnabled:           SweepEnabled(),
		HotMaxSOL:              HotMaxBalanceSOL(),
	}
	at, tx, solAmt, src := tm.LastTopUpSnapshot()
	if !at.IsZero() {
		t := at
		m.LastTopUpAt = &t
		m.LastTopUpTx = tx
		m.LastTopUpSOL = solAmt
		m.LastTopUpSource = src
	}
	return m
}

// AttachQueueMetrics fills queue depth/age onto stats (called from API with DB access).
func (stats *TreasuryStats) AttachQueueMetrics(depth int64, oldestAgeSecs int64) {
	if stats.Liquidity == nil {
		stats.Liquidity = &LiquidityMetrics{}
	}
	stats.Liquidity.QueueDepth = depth
	stats.Liquidity.QueueOldestAgeSecs = oldestAgeSecs
}

// WalletBalanceView is a single treasury wallet balance snapshot.
type WalletBalanceView struct {
	Address            string  `json:"address"`
	BalanceLamports    uint64  `json:"balance_lamports"`
	BalanceSOL         float64 `json:"balance_sol"`
	MinBalanceSOL      float64 `json:"min_balance_sol,omitempty"`
	MaxBalanceSOL      float64 `json:"max_balance_sol,omitempty"`
	ReplenishSOL       float64 `json:"replenish_sol,omitempty"`
	NeedsReplenish     bool    `json:"needs_replenish,omitempty"`
	BalanceUnavailable bool    `json:"balance_unavailable,omitempty"`
}

// TreasuryStats represents treasury statistics.
type TreasuryStats struct {
	Address                 string             `json:"address"`
	BalanceLamports         uint64             `json:"balance_lamports"`
	BalanceSOL              float64            `json:"balance_sol"`
	Hot                     WalletBalanceView  `json:"hot"`
	Cold                    *WalletBalanceView `json:"cold,omitempty"`
	Vault                   *WalletBalanceView `json:"vault,omitempty"`
	CombinedBalanceLamports uint64             `json:"combined_balance_lamports"`
	CombinedBalanceSOL      float64            `json:"combined_balance_sol"`
	Thresholds              TreasuryThresholds `json:"thresholds"`
	Status                  string             `json:"status"`
	LastCheckedAt           time.Time          `json:"last_checked_at"`
	Liquidity               *LiquidityMetrics  `json:"liquidity,omitempty"`
}

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

// RecordOutgoingTransfer records an outgoing transfer for velocity monitoring.
func (tm *TreasuryManager) RecordOutgoingTransfer(ctx context.Context, amountSOL float64) error {
	if tm == nil || tm.watchtower == nil {
		return nil
	}
	return tm.watchtower.RecordOutflow(ctx, amountSOL)
}
