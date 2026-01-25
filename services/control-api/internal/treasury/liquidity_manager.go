package treasury

import (
	"context"
	"fmt"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/solana"
)

const (
	// Thresholds
	MinSOLLamports    uint64 = 5 * 1_000_000_000  // 5 SOL
	TargetSOLLamports uint64 = 10 * 1_000_000_000 // 10 SOL

	// Tokens
	WSOLMint = "So11111111111111111111111111111111111111112"
	USDCMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" // Mainnet-beta (Devnet usually differs)
	USDTMint = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"

	// Thresholds for Stablecoins
	MinStableBalance uint64 = 100 * 1_000_000 // $100 (6 decimals)
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
				if err := lm.CheckTokenLiquidity(ctx); err != nil {
					fmt.Printf("Token Liquidity Check Failed: %v\n", err)
				}
				lm.YieldGenerationHook(ctx)
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

// CheckTokenLiquidity monitors USDC/USDT balances
func (lm *LiquidityManager) CheckTokenLiquidity(ctx context.Context) error {
	tokens := []string{USDCMint, USDTMint}
	treasury := lm.client.GetOraclePublicKey()

	for _, mintStr := range tokens {
		mint := sol.MustPublicKeyFromBase58(mintStr)
		balance, err := lm.client.GetTokenBalance(ctx, treasury, mint)
		if err != nil {
			logging.Warn().Str("mint", mint.String()).Err(err).Msg("Failed to check token balance")
			continue
		}

		logging.Info().Str("mint", mint.String()).Uint64("balance", balance).Msg("Treasury Token Balance")

		if balance < MinStableBalance {
			logging.Warn().Str("mint", mint.String()).Uint64("current", balance).Msg("Low stablecoin liquidity in treasury")
		}
	}
	return nil
}

// YieldGenerationHook is a stub for future DeFi yield optimization
func (lm *LiquidityManager) YieldGenerationHook(ctx context.Context) {
	// 1. Check if we have excess balance (e.g., >$10k)
	// 2. If yes, check Kamino/Solend rates
	// 3. Deposit portion of idle funds to earn yield
	// logging.Info().Msg("Yield generation check: All funds active.")
}
