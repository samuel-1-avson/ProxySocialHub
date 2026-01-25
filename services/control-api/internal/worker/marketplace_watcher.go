package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/nats-io/nats.go/jetstream"
	"github.com/proxyhubb/control-api/internal/core/domain"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/nats"
	"github.com/proxyhubb/control-api/internal/redis"
)

// MarketplaceWatcher consumes node telemetry and updates discovery caches
type MarketplaceWatcher struct {
	js jetstream.JetStream
}

func NewMarketplaceWatcher() *MarketplaceWatcher {
	return &MarketplaceWatcher{
		js: nats.JS,
	}
}

// Start initiates the NATS consumer for node heartbeats
func (w *MarketplaceWatcher) Start(ctx context.Context) error {
	if w.js == nil {
		return fmt.Errorf("NATS JetStream not initialized")
	}

	logging.Info().Msg("MarketplaceWatcher: Starting telemetry consumer...")

	// Create ephemeral consumer
	consumer, err := w.js.CreateOrUpdateConsumer(ctx, "TELEMETRY", jetstream.ConsumerConfig{
		Durable:       "marketplace-watcher",
		FilterSubject: "proxy.telemetry.v1.heartbeat",
		AckPolicy:     jetstream.AckExplicitPolicy,
	})
	if err != nil {
		return fmt.Errorf("failed to create telemetry consumer: %w", err)
	}

	go func() {
		iter, _ := consumer.Messages()
		for {
			msg, err := iter.Next()
			if err != nil {
				logging.Error(err).Msg("MarketplaceWatcher: Consumer iteration failed")
				time.Sleep(1 * time.Second)
				continue
			}

			var event domain.NodeHeartbeatEvent
			if err := json.Unmarshal(msg.Data(), &event); err != nil {
				logging.Error(err).Msg("MarketplaceWatcher: Failed to unmarshal heartbeat")
				msg.Term()
				continue
			}

			// Update Redis Discovery Cache
			w.updateDiscoveryCache(ctx, event)

			msg.Ack()
		}
	}()

	return nil
}

func (w *MarketplaceWatcher) updateDiscoveryCache(ctx context.Context, event domain.NodeHeartbeatEvent) {
	// Status Key: market:node:{id}:status
	statusKey := fmt.Sprintf("market:node:%s:status", event.NodeID)

	cacheData := map[string]interface{}{
		"healthy":    event.IsHealthy,
		"latency_ms": event.LatencyMs,
		"last_seen":  event.Timestamp.Unix(),
	}

	// We use a short TTL (e.g., 30 seconds) for heartbeats.
	// If a node silent for >30s, it's considered effectively offline in the UI.
	jsonData, _ := json.Marshal(cacheData)
	redis.Client.Set(ctx, statusKey, jsonData, 30*time.Second)

	// Also update a global "Active Nodes" set for fast filtering
	activeSetKey := "market:active_nodes"
	if event.IsHealthy {
		redis.Client.SAdd(ctx, activeSetKey, event.NodeID)
	} else {
		redis.Client.SRem(ctx, activeSetKey, event.NodeID)
	}
}
