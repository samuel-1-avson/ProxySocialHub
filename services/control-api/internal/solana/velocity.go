package solana

import (
	"context"
	"fmt"
	"log"
	"sync/atomic"
	"time"

	"github.com/proxyhubb/control-api/internal/decentralization"
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

// NewVelocityGuard reads limits from the single money-caps config
// (W-27: decentralization.MoneyCaps, validated at boot).
// rc may be nil — guard falls back to logging-only (less accurate across replicas).
func NewVelocityGuard(rc internalRedis.RedisClient, alertFn func(string, string)) *VelocityGuard {
	maxSingle := defaultMaxSingleTransferSOL
	maxHourly := defaultMaxHourlyOutflowSOL
	if caps, err := decentralization.MoneyCaps(); err == nil {
		maxSingle = caps.MaxSingleTransferSOL
		maxHourly = caps.MaxHourlyOutflowSOL
	} else {
		// Boot validation (ValidateSecurityPosture) rejects bad caps in
		// production; log loudly here and keep safe defaults.
		log.Printf("[velocity] invalid money caps (%v); using defaults single=%.2f hourly=%.2f", err, maxSingle, maxHourly)
	}
	return &VelocityGuard{
		redis:        rc,
		maxSingleSOL: maxSingle,
		maxHourlySOL: maxHourly,
		alertFn:      alertFn,
	}
}

// VelocityOutflowKey is THE outflow ledger key (W-27 one ledger): the
// watchtower observes this counter instead of keeping its own bucket.
func VelocityOutflowKey() string { return velocityRedisKey }

// Caps exposes the configured limits for observers (watchtower).
func (v *VelocityGuard) Caps() (singleSOL, hourlySOL float64) {
	return v.maxSingleSOL, v.maxHourlySOL
}

const velocityReleaseScript = `
local key = KEYS[1]
local amount = tonumber(ARGV[1])
local total = tonumber(redis.call('INCRBYFLOAT', key, -amount))
if total < 0 then
  redis.call('SET', key, '0', 'KEEPTTL')
  return '0'
end
return tostring(total)`

// Release returns a previously Checked (reserved) amount to the hourly
// budget after a DEFINITE send failure (W-27 reserve/settle accounting:
// Check reserves, broadcast success settles by keeping the reservation,
// failure releases). Reservations abandoned by a crash expire with the
// hourly window TTL.
func (v *VelocityGuard) Release(ctx context.Context, amountSOL float64) {
	if v == nil || v.redis == nil || amountSOL <= 0 {
		return
	}
	if err := v.redis.Eval(ctx, velocityReleaseScript, []string{velocityRedisKey}, fmt.Sprintf("%f", amountSOL)).Err(); err != nil {
		log.Printf("[velocity] release %.6f SOL failed: %v", amountSOL, err)
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

// Check RESERVES amountSOL against the hourly budget and validates all
// velocity limits (W-27): on success the caller owns a reservation -
// keep it on broadcast success (settled), Release it on definite
// failure. Returns an error if the transfer must be blocked (no
// reservation is held then; the Lua rollback already ran).
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
// ONLY for sends that bypassed Check (e.g. manually triggered
// transfers): calling it after a Checked send double-counts (W-27).
func (v *VelocityGuard) RecordOutflow(ctx context.Context, amountSOL float64) {
	if v.redis == nil {
		return
	}
	v.redis.IncrByFloat(ctx, velocityRedisKey, amountSOL)
	v.redis.Expire(ctx, velocityRedisKey, velocityWindow)
}
