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
	"github.com/redis/go-redis/v9"
)

const (
	// Default velocity limits — override via env vars.
	defaultMaxSingleTransferSOL = 50.0   // No single tx > 50 SOL
	defaultMaxHourlyOutflowSOL  = 500.0  // Total outflow per rolling 1-hour window

	velocityRedisKey  = "oracle:outflow:hourly" // Rolling hourly outflow counter (SOL)
	velocityFreezeKey = "oracle:freeze"         // P0-18: persisted freeze flag in Redis
	velocityWindow    = time.Hour
)

// velocityLuaScript atomically: increments the outflow counter, sets the TTL
// on first write (when TTL==-1), then checks the limit. If the limit would be
// exceeded it rolls back the increment and returns the over-limit value so the
// caller can detect the breach without a separate round-trip (P0-16 fix).
//
// KEYS[1] = counter key, ARGV[1] = amount (float string),
// ARGV[2] = hourly limit (float string), ARGV[3] = window seconds (int string)
// Returns: {new_total (bulk string), exceeded (0|1)}
const velocityLuaScript = `
local key    = KEYS[1]
local amount = tonumber(ARGV[1])
local limit  = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
local total  = tonumber(redis.call('INCRBYFLOAT', key, amount))
local ttl    = redis.call('TTL', key)
if ttl == -1 then
    redis.call('EXPIRE', key, window)
end
if total > limit then
    redis.call('INCRBYFLOAT', key, -amount)
    return {tostring(total), 1}
end
return {tostring(total), 0}
`

// VelocityGuard enforces per-transfer and hourly outflow limits on the oracle.
// It is embedded in OracleClient and checked before every SendSOL / BatchTransferSOL call.
type VelocityGuard struct {
	redis              internalRedis.RedisClient
	maxSingleSOL       float64
	maxHourlySOL       float64
	frozen             atomic.Bool // in-process cache; authoritative state is in Redis (P0-18)
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
// P0-18: the freeze flag is persisted in Redis so it survives process restarts.
func (v *VelocityGuard) Freeze() {
	v.frozen.Store(true)
	if v.redis != nil {
		v.redis.Set(context.Background(), velocityFreezeKey, "1", 0) // no TTL — must be explicitly cleared
	}
	log.Println("[ORACLE FREEZE] All oracle transfers are now FROZEN. Manual intervention required.")
	if v.alertFn != nil {
		v.alertFn("Oracle Transfers FROZEN", "All SOL transfers blocked. Call Unfreeze() or delete the Redis key to resume.")
	}
}

// Unfreeze re-enables oracle transfers and removes the Redis freeze flag.
func (v *VelocityGuard) Unfreeze() {
	v.frozen.Store(false)
	if v.redis != nil {
		v.redis.Del(context.Background(), velocityFreezeKey)
	}
	log.Println("[ORACLE UNFREEZE] Oracle transfers resumed.")
}

// IsFrozen returns true if the guard is frozen.
// P0-18: checks Redis first so a freeze set by another replica is honoured on startup.
func (v *VelocityGuard) IsFrozen() bool {
	if v.redis != nil {
		val, err := v.redis.Get(context.Background(), velocityFreezeKey).Result()
		if err == nil && val == "1" {
			v.frozen.Store(true) // sync in-process cache
			return true
		}
	}
	return v.frozen.Load()
}

// Check validates a proposed transfer against all velocity limits.
// Returns an error if the transfer must be blocked.
func (v *VelocityGuard) Check(ctx context.Context, amountSOL float64) error {
	// 1. Freeze check (P0-18: also polls Redis so inter-process freeze is honoured)
	if v.IsFrozen() {
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

	// 3. Hourly outflow window — P0-16: use a Lua script so increment, TTL-set, and
	//    limit-check are one atomic round-trip with no double-increment race.
	if v.redis == nil {
		// P0-17: Redis is required for accurate multi-instance tracking.
		// Block the transfer rather than silently skipping the check.
		return fmt.Errorf("transfer blocked: Redis is unavailable and hourly outflow cannot be verified")
	}

	windowSecs := int(velocityWindow.Seconds())
	cmd := v.redis.Eval(ctx, velocityLuaScript,
		[]string{velocityRedisKey},
		fmt.Sprintf("%f", amountSOL),
		fmt.Sprintf("%f", v.maxHourlySOL),
		fmt.Sprintf("%d", windowSecs),
	)
	totalStr, exceeded, err := parseVelocityEvalResult(cmd)
	if err != nil {
		// P0-17: Redis error → block the transfer, do not proceed unchecked.
		return fmt.Errorf("transfer blocked: Redis velocity check failed: %w", err)
	}

	if exceeded {
		// Lua script already rolled back the increment.
		msg := fmt.Sprintf("hourly outflow would reach %s SOL (limit: %.2f SOL)", totalStr, v.maxHourlySOL)
		if v.alertFn != nil {
			v.alertFn("Oracle: Hourly Velocity Limit Hit", msg)
		}
		return fmt.Errorf("transfer blocked: %s", msg)
	}

	return nil
}

// parseVelocityEvalResult reads the Lua script reply: {total_after_increment, exceeded_flag}.
func parseVelocityEvalResult(cmd *redis.Cmd) (total string, exceeded bool, err error) {
	raw, err := cmd.Result()
	if err != nil {
		return "", false, err
	}
	switch v := raw.(type) {
	case []interface{}:
		if len(v) < 2 {
			return "", false, fmt.Errorf("unexpected velocity script arity: %d", len(v))
		}
		return fmt.Sprint(v[0]), fmt.Sprint(v[1]) == "1", nil
	case []string:
		if len(v) < 2 {
			return "", false, fmt.Errorf("unexpected velocity script arity: %d", len(v))
		}
		return v[0], v[1] == "1", nil
	default:
		return "", false, fmt.Errorf("unexpected velocity script type %T", raw)
	}
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
