package treasury

import (
	"context"
	"fmt"
	"time"

	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/solana"
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

// RecordOutflow observes a completed transfer against THE outflow
// ledger (W-27 one ledger): the velocity guard's counter is the single
// source; the watchtower no longer keeps a second bucket with its own
// threshold. It early-warns at 80% of the hourly cap and keeps the
// emergency pause as defense-in-depth if the guard was ever bypassed.
func (w *Watchtower) RecordOutflow(ctx context.Context, amountSOL float64) error {
	if w == nil || redis.Client == nil {
		return nil
	}
	caps, capErr := decentralization.MoneyCaps()
	if capErr != nil {
		return nil // boot gate owns config errors; observation stays best-effort
	}
	total, err := redis.Client.Get(ctx, solana.VelocityOutflowKey()).Float64()
	if err != nil {
		if err == redis.Nil {
			total = amountSOL
		} else {
			return nil
		}
	}
	if total > caps.MaxHourlyOutflowSOL {
		w.TriggerAlert(ctx, "CRITICAL", "High Outflow Velocity detected", fmt.Sprintf("%.2f SOL/hr", total))
		return w.TriggerEmergencyPause(ctx, "Automatic Velocity Breach")
	}
	if total >= 0.8*caps.MaxHourlyOutflowSOL {
		w.TriggerAlert(ctx, "WARNING", "Outflow velocity at 80% of hourly cap", fmt.Sprintf("%.2f/%.2f SOL/hr", total, caps.MaxHourlyOutflowSOL))
	}
	if amountSOL > caps.MaxSingleTransferSOL {
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
