package events

import (
	"context"
	"time"
)

// EventType defines the type of event
type EventType string

const (
	EventTypeUserRegistered    EventType = "user.registered"
	EventTypeUserLoggedIn      EventType = "user.loggedin"
	EventTypeSessionStarted    EventType = "session.started"
	EventTypeSessionEnded      EventType = "session.ended"
	EventTypeBandwidthConsumed EventType = "bandwidth.consumed"
	EventTypeListingCreated    EventType = "listing.created"
	EventTypeOrderCreated      EventType = "order.created"
	EventTypeOrderFulfilled    EventType = "order.fulfilled"
)

// Event represents a system event
type Event struct {
	ID        string                 `json:"id"`
	Type      EventType              `json:"type"`
	Payload   map[string]interface{} `json:"payload"`
	Timestamp time.Time              `json:"timestamp"`
	Source    string                 `json:"source"`
}

// EventQueue defines the interface for publishing and subscribing to events
type EventQueue interface {
	// Publish sends an event to the queue
	Publish(ctx context.Context, event Event) error

	// Subscribe listens for events of a specific type
	Subscribe(ctx context.Context, eventType EventType, handler func(Event) error) error

	// Close closes the queue connection
	Close() error
}
