package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterAdminSessionStreamRoute adds the admin SSE session stream endpoint.
// It relies on the protected admin route group and existing admin auth middleware.
func RegisterAdminSessionStreamRoute(adminProtected *gin.RouterGroup, _ *config.Config) {
	adminProtected.GET("/sessions/stream", adminStreamSessions())
}

func adminStreamSessions() gin.HandlerFunc {
	return func(c *gin.Context) {
		adminRole, exists := c.Get("adminRole")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Admin authorization required"})
			return
		}

		role, _ := adminRole.(string)
		if role != "admin" && role != "superadmin" && role != "sysops" && role != "support" {
			c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient admin privileges"})
			return
		}

		c.Writer.Header().Set("Content-Type", "text/event-stream")
		c.Writer.Header().Set("Cache-Control", "no-cache")
		c.Writer.Header().Set("Connection", "keep-alive")
		c.Writer.Header().Set("X-Accel-Buffering", "no")
		c.Writer.WriteHeader(http.StatusOK)
		c.Writer.Flush()

		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()

		ctx := c.Request.Context()
		writeAdminSessionSnapshot(c)

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				writeAdminSessionSnapshot(c)
			}
		}
	}
}

type adminSessionItem struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	NodeID    string    `json:"node_id"`
	Status    string    `json:"status"`
	BytesUp   int64     `json:"bytes_up"`
	BytesDown int64     `json:"bytes_down"`
	StartedAt time.Time `json:"started_at"`
	DurationS int64     `json:"duration_s"`
}

type adminSessionPayload struct {
	Sessions []adminSessionItem `json:"sessions"`
	Total    int                `json:"total"`
}

func writeAdminSessionSnapshot(c *gin.Context) {
	var sessions []models.Session
	db.DB.Where("status = ?", models.SessionActive).
		Order("created_at DESC").
		Limit(200).
		Find(&sessions)

	items := make([]adminSessionItem, 0, len(sessions))
	for _, s := range sessions {
		nodeID := ""
		if s.NodeID != nil {
			nodeID = s.NodeID.String()
		}
		dur := int64(0)
		if !s.CreatedAt.IsZero() {
			dur = int64(time.Since(s.CreatedAt).Seconds())
		}
		items = append(items, adminSessionItem{
			ID:        s.ID.String(),
			UserID:    s.UserID.String(),
			NodeID:    nodeID,
			Status:    string(s.Status),
			BytesUp:   s.BytesUsed / 2,
			BytesDown: s.BytesUsed / 2,
			StartedAt: s.CreatedAt,
			DurationS: dur,
		})
	}

	payload := adminSessionPayload{Sessions: items, Total: len(items)}
	jsonData, err := json.Marshal(payload)
	if err != nil {
		fmt.Fprintf(c.Writer, "event: error\ndata: {\"error\": \"marshal failed\"}\n\n")
		c.Writer.Flush()
		return
	}

	// Admin panel listens for "session_update" events.
	fmt.Fprintf(c.Writer, "event: session_update\ndata: %s\n\n", jsonData)
	c.Writer.Flush()
}
