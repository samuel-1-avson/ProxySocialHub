package models

import (
	"time"

	"github.com/google/uuid"
)

const (
	MapLinkKindSessionAggregate = "session_aggregate"
	MapLinkProvenanceSession    = "session_intents"
	MapLinkGeoPrecisionRegion   = "region_hub"
)

// MapNodeLink is a materialized aggregated edge for map topology visualization.
type MapNodeLink struct {
	ID             uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	LinkKind       string    `gorm:"type:varchar(32);not null" json:"link_kind"`
	SourceKind     string    `gorm:"type:varchar(16);not null" json:"source_kind"`
	SourceID       string    `gorm:"type:varchar(120);not null" json:"source_id"`
	SourceLat      float64   `gorm:"type:numeric(10,6);not null" json:"source_lat"`
	SourceLon      float64   `gorm:"type:numeric(10,6);not null" json:"source_lon"`
	TargetKind     string    `gorm:"type:varchar(16);not null" json:"target_kind"`
	TargetID       string    `gorm:"type:varchar(120);not null" json:"target_id"`
	TargetLat      float64   `gorm:"type:numeric(10,6);not null" json:"target_lat"`
	TargetLon      float64   `gorm:"type:numeric(10,6);not null" json:"target_lon"`
	ActiveSessions int       `gorm:"not null;default:0" json:"active_sessions"`
	BytesUp1h      int64     `gorm:"column:bytes_up_1h;not null;default:0" json:"bytes_up_1h"`
	BytesDown1h    int64     `gorm:"column:bytes_down_1h;not null;default:0" json:"bytes_down_1h"`
	LatencyMsP50   *int      `gorm:"column:latency_ms_p50" json:"latency_ms_p50,omitempty"`
	LatencyMsP95   *int      `gorm:"column:latency_ms_p95" json:"latency_ms_p95,omitempty"`
	GeoPrecision   string    `gorm:"type:varchar(16);not null;default:'region_hub'" json:"geo_precision"`
	Provenance     string    `gorm:"type:varchar(32);not null" json:"provenance"`
	WindowStart    time.Time `gorm:"not null" json:"window_start"`
	WindowEnd      time.Time `gorm:"not null" json:"window_end"`
	UpdatedAt      time.Time `json:"updated_at"`
}

func (MapNodeLink) TableName() string {
	return "map_node_links"
}
