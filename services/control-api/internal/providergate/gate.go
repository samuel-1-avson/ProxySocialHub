package providergate

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
)

var (
	// ErrProviderRegistryInactive is returned in enforce mode when the on-chain
	// ProviderRegistry is missing, inactive, or heartbeat-stale (Wave 3.1 / DISC-01).
	ErrProviderRegistryInactive = errors.New("provider_registry_inactive")

	registryGateChecksTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "proxyhubb_provider_registry_gate_checks_total",
			Help: "ProviderRegistry gate outcomes by mode and result.",
		},
		[]string{"mode", "result"},
	)
)

// Check consults on-chain ProviderRegistry for the node hotkey.
// Mode off: no-op. observe: log/metric only. enforce: return ErrProviderRegistryInactive.
func Check(ctx context.Context, node *models.ProviderNode) error {
	mode := decentralization.ProviderRegistryGateMode()
	if mode == "off" || node == nil {
		return nil
	}

	hotkey := strings.TrimSpace(node.Hotkey)
	if hotkey == "" {
		registryGateChecksTotal.WithLabelValues(mode, "no_hotkey").Inc()
		logging.Warn().
			Str("mode", mode).
			Str("provider_node_id", node.ID.String()).
			Msg("provider registry gate: node has no hotkey")
		if mode == "enforce" {
			return fmt.Errorf("%w: node has no hotkey", ErrProviderRegistryInactive)
		}
		return nil
	}

	oracle := solanaClient.GetOracleClient()
	if oracle == nil {
		registryGateChecksTotal.WithLabelValues(mode, "no_oracle").Inc()
		logging.Warn().Str("mode", mode).Msg("provider registry gate: oracle unavailable")
		if mode == "enforce" {
			return fmt.Errorf("%w: oracle unavailable", ErrProviderRegistryInactive)
		}
		return nil
	}

	pubkey, err := sol.PublicKeyFromBase58(hotkey)
	if err != nil {
		registryGateChecksTotal.WithLabelValues(mode, "bad_hotkey").Inc()
		if mode == "enforce" {
			return fmt.Errorf("%w: invalid hotkey", ErrProviderRegistryInactive)
		}
		return nil
	}

	reg, err := oracle.ReadProviderRegistry(ctx, pubkey)
	if err != nil {
		registryGateChecksTotal.WithLabelValues(mode, "read_err").Inc()
		logging.Warn().Err(err).Str("hotkey", hotkey).Str("mode", mode).
			Msg("provider registry gate: ReadProviderRegistry failed")
		if mode == "enforce" {
			return fmt.Errorf("%w: registry read failed: %v", ErrProviderRegistryInactive, err)
		}
		return nil
	}

	maxAge := decentralization.ProviderRegistryHeartbeatMaxAge()
	hbAge := time.Since(time.Unix(reg.LastHeartbeat, 0))
	live := reg.IsActive && hbAge >= 0 && hbAge <= maxAge
	if live {
		registryGateChecksTotal.WithLabelValues(mode, "ok").Inc()
		return nil
	}

	registryGateChecksTotal.WithLabelValues(mode, "inactive").Inc()
	logging.Warn().
		Str("hotkey", hotkey).
		Str("mode", mode).
		Bool("is_active", reg.IsActive).
		Dur("heartbeat_age", hbAge).
		Dur("max_age", maxAge).
		Msg("provider registry gate: provider not live on-chain")
	if mode == "enforce" {
		return fmt.Errorf("%w: inactive or stale heartbeat", ErrProviderRegistryInactive)
	}
	return nil
}

// LiveStatus reads on-chain ProviderRegistry without respecting the gate mode.
// Used for discovery honesty annotations (Wave 3.2). Returns false when missing/stale.
func LiveStatus(ctx context.Context, node *models.ProviderNode) (live bool, heartbeatAge time.Duration, err error) {
	if node == nil {
		return false, 0, fmt.Errorf("nil node")
	}
	hotkey := strings.TrimSpace(node.Hotkey)
	if hotkey == "" {
		return false, 0, nil
	}
	oracle := solanaClient.GetOracleClient()
	if oracle == nil {
		return false, 0, fmt.Errorf("oracle unavailable")
	}
	pubkey, err := sol.PublicKeyFromBase58(hotkey)
	if err != nil {
		return false, 0, err
	}
	reg, err := oracle.ReadProviderRegistry(ctx, pubkey)
	if err != nil {
		return false, 0, err
	}
	maxAge := decentralization.ProviderRegistryHeartbeatMaxAge()
	hbAge := time.Since(time.Unix(reg.LastHeartbeat, 0))
	ok := reg.IsActive && hbAge >= 0 && hbAge <= maxAge
	return ok, hbAge, nil
}
