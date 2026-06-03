package funnel

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/datatypes"
)

// RecordParams describes a funnel event to persist.
type RecordParams struct {
	EventName string
	UserID    *uuid.UUID
	ListingID *uuid.UUID
	OrderID   *uuid.UUID
	Surface   string
	Meta      map[string]interface{}
}

// Record inserts a funnel event asynchronously. Failures are logged only.
func Record(ctx context.Context, params RecordParams) {
	if params.EventName == "" {
		return
	}
	if !models.IsValidFunnelEventName(params.EventName) {
		logging.Warn().Str("event_name", params.EventName).Msg("Ignoring invalid marketplace funnel event")
		return
	}

	meta := params.Meta
	if meta == nil {
		meta = map[string]interface{}{}
	}
	metaJSON, err := json.Marshal(meta)
	if err != nil {
		metaJSON = []byte("{}")
	}

	p := params
	go func() {
		row := models.MarketplaceFunnelEvent{
			SchemaVersion: models.MarketplaceFunnelSchemaV1,
			EventName:     p.EventName,
			UserID:        p.UserID,
			ListingID:     p.ListingID,
			OrderID:       p.OrderID,
			Surface:       p.Surface,
			Meta:          datatypes.JSON(metaJSON),
		}
		if err := db.DB.WithContext(context.Background()).Create(&row).Error; err != nil {
			logging.Warn().Err(err).Str("event_name", p.EventName).Msg("Failed to record marketplace funnel event")
		}
	}()
}
