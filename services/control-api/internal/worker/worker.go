package worker

import (
	"context"
	"log"

	"github.com/proxyhubb/control-api/internal/events"
)

// StartAll initializes all background workers
func StartAll(queue events.EventQueue) {
	// 1. Event Consumers
	StartConsumers(queue)

	// 2. Session Lifecycle Workers (Phase 17)
	StartSessionReaper()
	StartSessionActivationRetryWorker()
	StartSessionIntentExpireWorker()
	StartSessionGatewayCacheReaper() // Wave 2.2 — expire session_gateway_cache spill
	StartSubscriptionRenewalWorker()
	StartTelemetryWorker()
	StartQualityAssessor()
	StartPricingEvaluator() // AI-Native dynamic proxy pricing engine
	StartGDPRDeletionWorker()
	StartPrivacyRetentionWorker()

	log.Printf("[Worker] All background services initialized")
}

// StartConsumers initializes event consumers
func StartConsumers(queue events.EventQueue) {
	if queue == nil {
		log.Printf("[Worker] Skipping event consumers: No event queue provided")
		return
	}

	// Consumer for User Logged In events
	err := queue.Subscribe(context.Background(), events.EventTypeUserLoggedIn, func(event events.Event) error {
		log.Printf("[Worker] Account sign-in event processed")
		return nil
	})

	if err != nil {
		log.Printf("Failed to subscribe to user.loggedin: %v", err)
	}

	// Consumer for Bandwidth Consumed (Billing) events
	err = queue.Subscribe(context.Background(), events.EventTypeBandwidthConsumed, func(event events.Event) error {
		payload := event.Payload
		totalBytes := payload["total_bytes"].(float64)
		pricePerGB, ok := payload["price_per_gb"].(float64)
		if !ok || pricePerGB <= 0 {
			pricePerGB = 0.50 // Fallback
		}
		cost := (totalBytes / (1024 * 1024 * 1024)) * pricePerGB

		log.Printf("💰 [Billing] Charing user %s for %v bytes (Provider: %s) -> Cost: $%.4f",
			payload["user_id"], totalBytes, payload["provider_id"], cost)
		return nil
	})

	if err != nil {
		log.Printf("Failed to subscribe to bandwidth.consumed: %v", err)
	}
}
