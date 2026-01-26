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
	StartTelemetryWorker()

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
		log.Printf("🔹 [Worker] User logged in: %s (IP: %s)", event.Payload["email"], event.Payload["ip"])
		return nil
	})

	if err != nil {
		log.Printf("Failed to subscribe to user.loggedin: %v", err)
	}

	// Consumer for Bandwidth Consumed (Billing) events
	err = queue.Subscribe(context.Background(), events.EventTypeBandwidthConsumed, func(event events.Event) error {
		payload := event.Payload
		totalBytes := payload["total_bytes"].(float64) // JSON unmarshals numbers as float64
		cost := (totalBytes / (1024 * 1024 * 1024)) * 0.50

		log.Printf("💰 [Billing] Charing user %s for %v bytes (Provider: %s) -> Cost: $%.4f",
			payload["user_id"], totalBytes, payload["provider_id"], cost)
		return nil
	})

	if err != nil {
		log.Printf("Failed to subscribe to bandwidth.consumed: %v", err)
	}
}
