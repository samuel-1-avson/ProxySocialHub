package treasury

import (
	"context"
	"fmt"
	"time"

	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/redis"
)

const (
	// Configuration Keys
	EmergencyPauseKey = "system:emergency_pause_active"
	HourlyOutflowKey  = "treasury:outflow:hourly"

	// Default Thresholds
	MaxHourlySOLOutflow = 100.0 // SOL per hour
)

type Watchtower struct{}

func NewWatchtower() *Watchtower {
	return &Watchtower{}
}

// RecordOutflow records a transaction amount and checks for velocity spikes
func (w *Watchtower) RecordOutflow(ctx context.Context, amountSOL float64) error {
	// 1. Increment hourly bucket
	// Strategy: Use a Redis key that expires after 1 hour or a sorted set for sliding window
	// For MVP: Simple hourly key
	now := time.Now().Hour()
	key := fmt.Sprintf("%s:%d", HourlyOutflowKey, now)

	val, err := redis.Client.IncrByFloat(ctx, key, amountSOL).Result()
	if err != nil {
		return fmt.Errorf("failed to record velocity: %w", err)
	}

	// 2. Set TTL if new key
	if val == amountSOL {
		redis.Client.Expire(ctx, key, 1*time.Hour)
	}

	// 3. Check Velocity Spike
	if val > MaxHourlySOLOutflow {
		logging.Warn().
			Float64("current_hourly", val).
			Float64("threshold", MaxHourlySOLOutflow).
			Msg("VELOCITY ALERT: Outflow threshold exceeded. Triggering Emergency Pause.")

		return w.TriggerEmergencyPause(ctx, "Automatic Velocity Breach")
	}

	logging.Debug().Float64("outflow", amountSOL).Float64("hourly_total", val).Msg("Watchtower Log")
	return nil
}

// TriggerEmergencyPause sets the global shutdown flag
func (w *Watchtower) TriggerEmergencyPause(ctx context.Context, reason string) error {
	err := redis.Client.Set(ctx, EmergencyPauseKey, "true", 0).Err()
	if err != nil {
		return fmt.Errorf("failed to trigger pause: %w", err)
	}

	logging.Info().Str("reason", reason).Msg("SYSTEM EMERGENCY PAUSE ACTIVATED")
	return nil
}

// IsPaused checks if the system is currently in emergency shutdown
func (w *Watchtower) IsPaused(ctx context.Context) (bool, error) {
	val, err := redis.Client.Get(ctx, EmergencyPauseKey).Result()
	if err == redis.Nil {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return val == "true", nil
}

// ResolveEmergencyPause clears the pause flag
func (w *Watchtower) ResolveEmergencyPause(ctx context.Context) error {
	return redis.Client.Del(ctx, EmergencyPauseKey).Err()
}
