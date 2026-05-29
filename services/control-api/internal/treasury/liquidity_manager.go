package treasury

import (
	"context"
	"fmt"
	"os"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/solana"
)

const (
	// SOL-only system - no stablecoin mints needed
	WSOLMint = "So11111111111111111111111111111111111111112"

	// DevNet Thresholds (Backward Compatibility)
	DevNetMinSOLLamports    uint64 = 5 * 1_000_000_000   // 5 SOL
	DevNetTargetSOLLamports uint64 = 10 * 1_000_000_000  // 10 SOL

	// MainNet Thresholds (Production-Ready)
	MainNetMinSOLLamports    uint64 = 100 * 1_000_000_000  // 100 SOL (~$20,000)
	MainNetTargetSOLLamports uint64 = 500 * 1_000_000_000  // 500 SOL (~$100,000)
)

type LiquidityManager struct {
	client *solana.OracleClient
}

func NewLiquidityManager(client *solana.OracleClient) *LiquidityManager {
	return &LiquidityManager{
		client: client,
	}
}

// StartRebalanceLoop runs periodically to check balances
func (lm *LiquidityManager) StartRebalanceLoop(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := lm.CheckBalances(ctx); err != nil {
					fmt.Printf("SOL Liquidity Check Failed: %v\n", err)
				}
				lm.YieldGenerationHook(ctx)
			}
		}
	}()
}

// CheckBalances checks Treasury balances and alerts if low
// Uses environment-aware thresholds for proper production monitoring
func (lm *LiquidityManager) CheckBalances(ctx context.Context) error {
	// 1. Get Treasury Balance
	treasury := lm.getTreasuryAddress()
	lamports, err := lm.client.GetBalance(ctx, treasury)
	if err != nil {
		return fmt.Errorf("failed to get balance: %w", err)
	}

	balanceSOL := solana.LamportsToSOL(lamports)
	
	// Get environment-appropriate thresholds
	minLamports, targetLamports := lm.getThresholds()
	
	logging.Info().
		Float64("SOL", balanceSOL).
		Float64("min_sol", float64(minLamports)/1e9).
		Float64("target_sol", float64(targetLamports)/1e9).
		Str("network", lm.getNetwork()).
		Msg("Checking Treasury Liquidity")

	// 2. Alert based on severity
	if lamports < minLamports {
		logging.Error(fmt.Errorf("treasury balance below minimum")).
			Float64("current", balanceSOL).
			Float64("minimum", float64(minLamports)/1e9).
			Msg("CRITICAL: Treasury balance below minimum threshold - immediate action required")
		// In production, this triggers emergency alerts
	} else if lamports < targetLamports/2 {
		logging.Warn().
			Float64("current", balanceSOL).
			Float64("target", float64(targetLamports)/1e9).
			Msg("WARNING: Treasury balance below 50% of target - topup recommended")
	}

	return nil
}

// CheckTokenLiquidity - DEPRECATED: SOL-only system
// Previously monitored USDC/USDT balances - now returns nil
func (lm *LiquidityManager) CheckTokenLiquidity(ctx context.Context) error {
	// SOL-only system: No stablecoin monitoring needed
	return nil
}

// YieldGenerationHook is a stub for future DeFi yield optimization
func (lm *LiquidityManager) YieldGenerationHook(ctx context.Context) {
	// 1. Check if we have excess balance (e.g., >$10k)
	// 2. If yes, check Kamino/Solend rates
	// 3. Deposit portion of idle funds to earn yield
	// logging.Info().Msg("Yield generation check: All funds active.")
}

// getThresholds returns the appropriate thresholds based on environment
func (lm *LiquidityManager) getThresholds() (minLamports, targetLamports uint64) {
	network := lm.getNetwork()
	if network == "mainnet-beta" {
		return MainNetMinSOLLamports, MainNetTargetSOLLamports
	}
	return DevNetMinSOLLamports, DevNetTargetSOLLamports
}



// getNetwork returns the current Solana network
func (lm *LiquidityManager) getNetwork() string {
	if lm.client != nil {
		return lm.client.GetNetwork()
	}
	return os.Getenv("SOLANA_NETWORK")
}

func (lm *LiquidityManager) getTreasuryAddress() sol.PublicKey {
	if pk := GetHotTreasuryPubkey(); !pk.IsZero() {
		return pk
	}
	return lm.client.GetOraclePublicKey()
}
