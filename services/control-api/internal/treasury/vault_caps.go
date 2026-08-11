package treasury

import (
	"context"
	"fmt"
	"time"

	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/redis"
)

const vaultDailyTopUpKeyPrefix = "treasury:vault_topup:daily:"

// vaultDailyTopUpKey returns the Redis key for today's UTC vault→hot volume.
func vaultDailyTopUpKey(t time.Time) string {
	return vaultDailyTopUpKeyPrefix + t.UTC().Format("2006-01-02")
}

// RemainingVaultDailyTopUpSOL returns how much more vault→hot is allowed today.
// If Redis is unavailable, returns the full daily cap (fail-open with a warning).
func RemainingVaultDailyTopUpSOL(ctx context.Context) float64 {
	capSOL := VaultDailyTopUpCapSOL()
	if redis.Client == nil {
		return capSOL
	}
	key := vaultDailyTopUpKey(time.Now())
	used, err := redis.Client.Get(ctx, key).Float64()
	if err == redis.Nil {
		return capSOL
	}
	if err != nil {
		logging.Warn().Err(err).Msg("vault daily top-up cap: redis read failed; allowing full cap")
		return capSOL
	}
	remaining := capSOL - used
	if remaining < 0 {
		return 0
	}
	return remaining
}

// RecordVaultTopUpSOL increments the daily vault→hot counter after a successful submit.
func RecordVaultTopUpSOL(ctx context.Context, amountSOL float64) {
	if amountSOL <= 0 || redis.Client == nil {
		return
	}
	key := vaultDailyTopUpKey(time.Now())
	if err := redis.Client.IncrByFloat(ctx, key, amountSOL).Err(); err != nil {
		logging.Warn().Err(err).Float64("amount_sol", amountSOL).Msg("failed to record vault daily top-up")
		return
	}
	_ = redis.Client.Expire(ctx, key, 36*time.Hour).Err()
}

// CapVaultTopUpAmount applies per-tx max, reserve floor awareness (caller subtracts floor
// from available), and daily remaining cap. Returns 0 when nothing may be moved.
func CapVaultTopUpAmount(ctx context.Context, requestedSOL float64) (float64, error) {
	if requestedSOL <= 0 {
		return 0, fmt.Errorf("amount must be positive")
	}
	capped := requestedSOL
	if max := VaultTopUpMaxSOL(); capped > max {
		capped = max
	}
	remaining := RemainingVaultDailyTopUpSOL(ctx)
	if remaining <= 0 {
		return 0, fmt.Errorf("vault→hot daily cap reached (%.4f SOL)", VaultDailyTopUpCapSOL())
	}
	if capped > remaining {
		capped = remaining
	}
	return capped, nil
}
