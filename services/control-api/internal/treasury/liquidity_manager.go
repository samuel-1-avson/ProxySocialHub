package treasury

import (
	"context"
	"fmt"
	"time"

	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/solana"
)

const (
	// Thresholds
	MinSOLLamports    uint64 = 5 * 1_000_000_000  // 5 SOL
	TargetSOLLamports uint64 = 10 * 1_000_000_000 // 10 SOL

	// Tokens
	WSOLMint = "So11111111111111111111111111111111111111112"
	TAOMint  = "" // Removed
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
					// Log error but continue loop
					fmt.Printf("Liquidity Check Failed: %v\n", err)
				}
			}
		}
	}()
}

// CheckBalances checks Treasury balances and alerts if low
func (lm *LiquidityManager) CheckBalances(ctx context.Context) error {
	// 1. Get Oracle/Treasury Balance (Operational Wallet)
	lamports, err := lm.client.GetBalance(ctx, lm.client.GetOraclePublicKey())
	if err != nil {
		return fmt.Errorf("failed to get balance: %w", err)
	}

	balanceSOL := solana.LamportsToSOL(lamports)
	logging.Info().Float64("SOL", balanceSOL).Msg("Checking Treasury Liquidity")

	// 2. Alert if low
	if lamports < MinSOLLamports {
		logging.Warn().Float64("current", balanceSOL).Msg("CRITICAL: Low SOL Liquidity in Treasury. Please Top Up.")
		// In a real system, send an email or Slack alert here
	}

	return nil
}
