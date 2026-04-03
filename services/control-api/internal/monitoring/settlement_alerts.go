package monitoring

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/proxyhubb/control-api/internal/alerts"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/solana"
)

// StartSettlementTelemetryAlerts polls in-memory settlement telemetry and emits
// alerts only for newly observed failures or missing-source attempts.
func StartSettlementTelemetryAlerts(ctx context.Context) {
	if !getBoolEnv("ENABLE_SETTLEMENT_TELEMETRY_ALERTS", true) {
		logging.Info().Msg("Settlement telemetry alert monitor disabled by env")
		return
	}

	interval := time.Duration(getIntEnv("SETTLEMENT_TELEMETRY_ALERT_INTERVAL_SECONDS", 60)) * time.Second
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	logging.Info().
		Dur("interval", interval).
		Msg("Settlement telemetry alert monitor started")

	lastFailures := map[string]uint64{}
	lastAttempts := map[string]uint64{}
	initialized := false

	for {
		select {
		case <-ctx.Done():
			logging.Info().Msg("Settlement telemetry alert monitor stopped")
			return
		case <-ticker.C:
			telemetry := solana.GetSettlementTelemetrySnapshot()
			if len(telemetry) == 0 {
				continue
			}

			if !initialized {
				for _, item := range telemetry {
					lastFailures[item.Source] = item.Failures
					lastAttempts[item.Source] = item.Attempts
				}
				initialized = true
				continue
			}

			for _, item := range telemetry {
				prevFailures := lastFailures[item.Source]
				if item.Failures > prevFailures {
					delta := item.Failures - prevFailures
					title := "Settlement path failures detected"
					message := fmt.Sprintf(
						"source=%s new_failures=%d total_failures=%d last_error=%s",
						item.Source,
						delta,
						item.Failures,
						truncate(item.LastError, 240),
					)
					alerts.Send(alerts.Warning, title, message)
					logging.Warn().
						Str("source", item.Source).
						Uint64("new_failures", delta).
						Uint64("total_failures", item.Failures).
						Msg("Settlement telemetry detected failure delta")
				}

				if item.Source == "missing_source" {
					prevAttempts := lastAttempts[item.Source]
					if item.Attempts > prevAttempts {
						delta := item.Attempts - prevAttempts
						title := "Settlement source label missing"
						message := fmt.Sprintf(
							"missing_source attempts increased by %d (total=%d). A settlement caller is bypassing mandatory source labeling.",
							delta,
							item.Attempts,
						)
						alerts.Send(alerts.Critical, title, message)
						logging.Error(nil).
							Uint64("new_missing_source_attempts", delta).
							Uint64("total_missing_source_attempts", item.Attempts).
							Msg("Settlement telemetry detected missing source attempts")
					}
				}

				lastFailures[item.Source] = item.Failures
				lastAttempts[item.Source] = item.Attempts
			}
		}
	}
}

func getBoolEnv(key string, defaultValue bool) bool {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return defaultValue
	}
	return strings.EqualFold(raw, "true") || raw == "1"
}

func getIntEnv(key string, defaultValue int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return defaultValue
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return defaultValue
	}
	return value
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
