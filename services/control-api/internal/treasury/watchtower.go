package treasury

import (
	"context"
	"fmt"
	"time"

	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/nats"
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

// AlertEvent represents an infrastructure signal sent via NATS
type AlertEvent struct {
	Type      string    `json:"type"`
	Severity  string    `json:"severity"` // INFO, WARNING, CRITICAL
	Message   string    `json:"message"`
	Resource  string    `json:"resource"`
	Timestamp time.Time `json:"timestamp"`
}

// RecordOutflow records a transaction amount and checks for velocity spikes
func (w *Watchtower) RecordOutflow(ctx context.Context, amountSOL float64) error {
	if w == nil || redis.Client == nil {
		return nil
	}
	// 1. Increment hourly bucket
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
		w.TriggerAlert(ctx, "CRITICAL", "High Outflow Velocity detected", fmt.Sprintf("%.2f SOL/hr", val))
		return w.TriggerEmergencyPause(ctx, "Automatic Velocity Breach")
	}

	if amountSOL > 50.0 {
		w.TriggerAlert(ctx, "WARNING", "Large Outflow detected", fmt.Sprintf("%.2f SOL", amountSOL))
	}

	return nil
}

// RecordNodeOffline triggers an alert for infrastructure degradation
func (w *Watchtower) RecordNodeOffline(ctx context.Context, nodeID string) {
	w.TriggerAlert(ctx, "WARNING", "Node Connectivity Lost", nodeID)
}

// RecordEconomicRisk triggers an alert for high-value treasury operations
func (w *Watchtower) RecordEconomicRisk(ctx context.Context, message string, resource string) {
	w.TriggerAlert(ctx, "CRITICAL", message, resource)
}

// RecordSecurityAnomaly triggers an alert for unauthorized protocol actions
func (w *Watchtower) RecordSecurityAnomaly(ctx context.Context, message string, resource string) {
	w.TriggerAlert(ctx, "CRITICAL", "Security Anomaly detected", resource)
}

// TriggerAlert publishes a high-fidelity signal to NATS
func (w *Watchtower) TriggerAlert(ctx context.Context, severity, message, resource string) {
	event := AlertEvent{
		Type:      "watchtower_trigger",
		Severity:  severity,
		Message:   message,
		Resource:  resource,
		Timestamp: time.Now(),
	}

	// Publish to alerts stream
	nats.Publish(ctx, "proxy.telemetry.v1.alerts", event)
	logging.Info().Str("severity", severity).Str("msg", message).Msg("Watchtower Alert Triggered")
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
