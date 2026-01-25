package domain

import "time"

// SessionCreatedEvent is published when a new proxy session is initialized
type SessionCreatedEvent struct {
	SessionID      string    `json:"session_id"`
	BuyerID        string    `json:"buyer_id"`
	ProviderID     string    `json:"provider_id"`
	ListingID      string    `json:"listing_id"`
	BandwidthLimit int64     `json:"bandwidth_limit"`
	Timestamp      time.Time `json:"timestamp"`
}

// SessionTerminatedEvent is published when a proxy session is closed
type SessionTerminatedEvent struct {
	SessionID string    `json:"session_id"`
	Timestamp time.Time `json:"timestamp"`
}

// NodeHeartbeatEvent is published by nodes to signal health and performance
type NodeHeartbeatEvent struct {
	NodeID    string    `json:"node_id"`
	IsHealthy bool      `json:"is_healthy"`
	LatencyMs int       `json:"latency_ms"`
	Timestamp time.Time `json:"timestamp"`
}
