package models

import "time"

// WatcherCursor is the durable per-address ingestion watermark (W-26).
// The watcher used to keep lastSlot in memory, so any event between the
// last poll and a restart was skipped forever.
type WatcherCursor struct {
	Address       string    `gorm:"type:varchar(64);primaryKey" json:"address"`
	LastSlot      uint64    `gorm:"not null;default:0" json:"last_slot"`
	LastSignature string    `gorm:"type:varchar(128)" json:"last_signature,omitempty"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (WatcherCursor) TableName() string { return "watcher_cursors" }

// WatcherProcessedEvent is the durable dedup log for watcher events
// (W-26): survives Redis flushes/restarts, unlike the 10-minute SetNX.
type WatcherProcessedEvent struct {
	TxSignature string    `gorm:"type:varchar(128);primaryKey" json:"tx_signature"`
	EventType   string    `gorm:"type:varchar(32);primaryKey" json:"event_type"`
	ProcessedAt time.Time `json:"processed_at"`
}

func (WatcherProcessedEvent) TableName() string { return "watcher_processed_events" }
