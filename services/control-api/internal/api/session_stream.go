package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// sessionStreamItem is the per-session payload sent over SSE.
type sessionStreamItem struct {
	ID             string    `json:"id"`
	BuyerID        string    `json:"buyer_id"`
	ProviderID     string    `json:"provider_id"`
	Status         string    `json:"status"`
	BytesUsed      int64     `json:"bytes_used"`
	BandwidthLimit int64     `json:"bandwidth_limit"`
	StartedAt      time.Time `json:"started_at"`
}

// sessionStreamPayload is the top-level SSE data object.
type sessionStreamPayload struct {
	Sessions       []sessionStreamItem `json:"sessions"`
	Count          int                 `json:"count"`
	TotalBytesUsed int64               `json:"total_bytes_used"`
}

// RegisterSessionStreamRoutes attaches the SSE stream endpoint to the protected router group.
func RegisterSessionStreamRoutes(protected *gin.RouterGroup) {
	protected.GET("/sessions/stream", StreamSessions)
}

// StreamSessions is a Server-Sent Events endpoint that pushes active session
// statistics to the connected client every 3 seconds until the client disconnects.
func StreamSessions(c *gin.Context) {
	// Require authenticated user.
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Set SSE headers.
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(http.StatusOK)
	c.Writer.Flush()

	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	ctx := c.Request.Context()

	// Send an initial snapshot immediately on connect.
	writeSessionSnapshot(c, userUUID.String())

	for {
		select {
		case <-ctx.Done():
			// Client disconnected — exit cleanly.
			return
		case <-ticker.C:
			writeSessionSnapshot(c, userUUID.String())
		}
	}
}

// writeSessionSnapshot queries active sessions for the given user and writes
// a single SSE event to the response writer.
func writeSessionSnapshot(c *gin.Context, userID string) {
	var sessions []models.Session
	db.DB.Where("user_id = ? AND status = ?", userID, models.SessionActive).
		Order("created_at DESC").
		Find(&sessions)

	items := make([]sessionStreamItem, 0, len(sessions))
	var totalBytes int64

	for _, s := range sessions {
		providerID := ""
		if s.NodeID != nil {
			providerID = s.NodeID.String()
		}

		items = append(items, sessionStreamItem{
			ID:             s.ID.String(),
			BuyerID:        s.UserID.String(),
			ProviderID:     providerID,
			Status:         string(s.Status),
			BytesUsed:      s.BytesUsed,
			BandwidthLimit: s.BandwidthLimit,
			StartedAt:      s.CreatedAt,
		})
		totalBytes += s.BytesUsed
	}

	payload := sessionStreamPayload{
		Sessions:       items,
		Count:          len(items),
		TotalBytesUsed: totalBytes,
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		// Write an error event and continue; don't crash the stream.
		fmt.Fprintf(c.Writer, "event: error\ndata: {\"error\": \"marshal failed\"}\n\n")
		c.Writer.Flush()
		return
	}

	fmt.Fprintf(c.Writer, "event: sessions\ndata: %s\n\n", jsonData)
	c.Writer.Flush()
}
