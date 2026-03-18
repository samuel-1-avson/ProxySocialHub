package solana

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"sync/atomic"
	"time"

	internalRedis "github.com/proxyhubb/control-api/internal/redis"
)

const (
	// Default velocity limits — override via env vars.
	defaultMaxSingleTransferSOL = 50.0   // No single tx > 50 SOL
	defaultMaxHourlyOutflowSOL  = 500.0  // Total outflow per rolling 1-hour window

	velocityRedisKey = "oracle:outflow:hourly" // Rolling hourly outflow counter (SOL)
	velocityWindow   = time.Hour
)

// VelocityGuard enforces per-transfer and hourly outflow limits on the oracle.
// It is embedded in OracleClient and checked before every SendSOL / BatchTransferSOL call.
type VelocityGuard struct {
	redis              internalRedis.RedisClient
	maxSingleSOL       float64
	maxHourlySOL       float64
	frozen             atomic.Bool // true → all transfers blocked until manually cleared
	alertFn            func(title, message string) // injected alert callback
}

// NewVelocityGuard reads limits from env vars and returns a configured guard.
// rc may be nil — guard falls back to logging-only (less accurate across replicas).
func NewVelocityGuard(rc internalRedis.RedisClient, alertFn func(string, string)) *VelocityGuard {
	maxSingle := defaultMaxSingleTransferSOL
	if v := os.Getenv("ORACLE_MAX_SINGLE_TRANSFER_SOL"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			maxSingle = f
		}
	}
	maxHourly := defaultMaxHourlyOutflowSOL
	if v := os.Getenv("ORACLE_MAX_HOURLY_OUTFLOW_SOL"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			maxHourly = f
		}
	}
	return &VelocityGuard{
		redis:        rc,
		maxSingleSOL: maxSingle,
		maxHourlySOL: maxHourly,
		alertFn:      alertFn,
	}
}

// Freeze blocks all oracle transfers immediately.
// Use this when a compromise is suspected. Cleared only by Unfreeze() or restart.
func (v *VelocityGuard) Freeze() {
	v.frozen.Store(true)
	log.Println("[ORACLE FREEZE] All oracle transfers are now FROZEN. Manual intervention required.")
	if v.alertFn != nil {
		v.alertFn("Oracle Transfers FROZEN", "All SOL transfers blocked. Set ORACLE_TRANSFER_FREEZE=false and restart to unfreeze.")
	}
}

// Unfreeze re-enables oracle transfers.
func (v *VelocityGuard) Unfreeze() {
	v.frozen.Store(false)
	log.Println("[ORACLE UNFREEZE] Oracle transfers resumed.")
}

// IsFrozen returns the current freeze state.
func (v *VelocityGuard) IsFrozen() bool {
	return v.frozen.Load()
}

// Check validates a proposed transfer against all velocity limits.
// Returns an error if the transfer must be blocked.
func (v *VelocityGuard) Check(ctx context.Context, amountSOL float64) error {
	// 1. Freeze check
	if v.frozen.Load() {
		return fmt.Errorf("oracle transfers are frozen — manual review required before resuming")
	}

	// 2. Single-transfer cap
	if amountSOL > v.maxSingleSOL {
		msg := fmt.Sprintf("%.6f SOL requested but single-transfer cap is %.2f SOL", amountSOL, v.maxSingleSOL)
		if v.alertFn != nil {
			v.alertFn("Oracle: Single Transfer Limit Exceeded", msg)
		}
		return fmt.Errorf("transfer blocked: %s", msg)
	}

	// 3. Hourly outflow window (Redis-backed for multi-instance accuracy)
	if v.redis != nil {
		newTotal, err := v.redis.IncrByFloat(ctx, velocityRedisKey, amountSOL).Result()
		if err == nil {
			// Set TTL only if key is new (TTL = -1 means no expiry set yet)
			v.redis.Expire(ctx, velocityRedisKey, velocityWindow)

			if newTotal > v.maxHourlySOL {
				// Roll back the increment so the key doesn't accumulate stale excess
				v.redis.IncrByFloat(ctx, velocityRedisKey, -amountSOL)

				msg := fmt.Sprintf("hourly outflow would reach %.4f SOL (limit: %.2f SOL)", newTotal, v.maxHourlySOL)
				if v.alertFn != nil {
					v.alertFn("Oracle: Hourly Velocity Limit Hit", msg)
				}
				return fmt.Errorf("transfer blocked: %s", msg)
			}
		} else {
			// Redis unavailable — log but allow (avoid blocking payouts on Redis hiccup)
			log.Printf("[VelocityGuard] Redis error tracking outflow: %v — proceeding without hourly check", err)
		}
	}

	return nil
}

// RecordOutflow records a completed transfer in the hourly window.
// Call this after a successful transfer to keep the counter accurate
// even when Check() was not called (e.g., manually triggered transfers).
func (v *VelocityGuard) RecordOutflow(ctx context.Context, amountSOL float64) {
	if v.redis == nil {
		return
	}
	v.redis.IncrByFloat(ctx, velocityRedisKey, amountSOL)
	v.redis.Expire(ctx, velocityRedisKey, velocityWindow)
}
