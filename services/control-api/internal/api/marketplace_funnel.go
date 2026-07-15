package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/marketplace/funnel"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterMarketplaceFunnelRoutes registers client-ingested funnel events (optional auth).
func RegisterMarketplaceFunnelRoutes(rg *gin.RouterGroup) {
	rg.POST("/marketplace/funnel-events", ingestMarketplaceFunnelEvent)
}

type ingestFunnelEventRequest struct {
	Event         string                 `json:"event" binding:"required"`
	SchemaVersion string                 `json:"schema_version"`
	ListingID     string                 `json:"listing_id"`
	OrderID       string                 `json:"order_id"`
	Surface       string                 `json:"surface"`
	Meta          map[string]interface{} `json:"meta"`
}

// Client-ingested events only; server-authoritative steps are recorded in handlers/workers.
var clientIngestFunnelEvents = map[string]bool{
	models.FunnelListingView:  true,
	models.FunnelBuyModalOpen: true,
}

func ingestMarketplaceFunnelEvent(c *gin.Context) {
	var req ingestFunnelEventRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if req.SchemaVersion != "" && req.SchemaVersion != models.MarketplaceFunnelSchemaV1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported schema_version"})
		return
	}

	if !clientIngestFunnelEvents[req.Event] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Event not accepted via client ingest"})
		return
	}

	var listingID *uuid.UUID
	if req.ListingID != "" {
		id, err := uuid.Parse(req.ListingID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing_id"})
			return
		}
		listingID = &id
	}

	var orderID *uuid.UUID
	if req.OrderID != "" {
		id, err := uuid.Parse(req.OrderID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order_id"})
			return
		}
		orderID = &id
	}

	var userID *uuid.UUID
	if uid, err := parseOptionalUserIDFromContext(c); err == nil && uid != nil {
		userID = uid
	}

	funnel.Record(c.Request.Context(), funnel.RecordParams{
		EventName: req.Event,
		UserID:    userID,
		ListingID: listingID,
		OrderID:   orderID,
		Surface:   req.Surface,
		Meta:      sanitizeFunnelMeta(req.Meta),
	})

	c.JSON(http.StatusAccepted, gin.H{"ok": true})
}

func parseOptionalUserIDFromContext(c *gin.Context) (*uuid.UUID, error) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	if userIDStr == "" {
		return nil, nil
	}
	id, err := uuid.Parse(userIDStr)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// sanitizeFunnelMeta strips keys that must not be stored (PII guardrail).
func sanitizeFunnelMeta(meta map[string]interface{}) map[string]interface{} {
	if meta == nil {
		return map[string]interface{}{}
	}
	blocked := map[string]bool{
		"email": true, "username": true, "wallet": true, "wallet_address": true,
		"ip": true, "user_agent": true,
	}
	out := make(map[string]interface{}, len(meta))
	for k, v := range meta {
		if blocked[k] {
			continue
		}
		switch val := v.(type) {
		case string, bool, float64, int, int64, nil:
			out[k] = val
		}
	}
	return out
}
