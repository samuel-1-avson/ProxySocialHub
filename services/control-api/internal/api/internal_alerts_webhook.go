package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/alerts"
	"github.com/proxyhubb/control-api/internal/db"
)

// RegisterInternalAlertWebhook mounts POST /internal/alerts/webhook for Grafana
// (and similar) notification forwarders on the Docker network, plus
// GET /internal/alerts/recent for the durable ops_alerts journal.
// Auth: X-Alert-Token or Authorization: Bearer <token> must match
// INTERNAL_ALERT_WEBHOOK_TOKEN (fallback: GATEWAY_SHARED_SECRET).
func RegisterInternalAlertWebhook(r *gin.Engine) {
	r.POST("/internal/alerts/webhook", handleInternalAlertWebhook)
	r.GET("/internal/alerts/recent", handleOpsAlertsRecent)
}

func handleInternalAlertWebhook(c *gin.Context) {
	expected := strings.TrimSpace(os.Getenv("INTERNAL_ALERT_WEBHOOK_TOKEN"))
	if expected == "" {
		expected = strings.TrimSpace(os.Getenv("GATEWAY_SHARED_SECRET"))
	}
	if expected == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "alert webhook token not configured"})
		return
	}
	provided := strings.TrimSpace(c.GetHeader("X-Alert-Token"))
	if provided == "" {
		auth := strings.TrimSpace(c.GetHeader("Authorization"))
		if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
			provided = strings.TrimSpace(auth[7:])
		}
	}
	if provided == "" || provided != expected {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	body, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "read body"})
		return
	}
	title, message, level := parseGrafanaAlertPayload(body)
	alerts.Send(level, title, message)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func handleOpsAlertsRecent(c *gin.Context) {
	expected := strings.TrimSpace(os.Getenv("INTERNAL_ALERT_WEBHOOK_TOKEN"))
	if expected == "" {
		expected = strings.TrimSpace(os.Getenv("GATEWAY_SHARED_SECRET"))
	}
	if expected == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "alert token not configured"})
		return
	}
	provided := strings.TrimSpace(c.GetHeader("X-Alert-Token"))
	if provided == "" {
		auth := strings.TrimSpace(c.GetHeader("Authorization"))
		if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
			provided = strings.TrimSpace(auth[7:])
		}
	}
	if provided == "" || provided != expected {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	limit := 50
	type row struct {
		ID        string    `json:"id" gorm:"column:id"`
		CreatedAt time.Time `json:"created_at" gorm:"column:created_at"`
		Level     string    `json:"level" gorm:"column:level"`
		Title     string    `json:"title" gorm:"column:title"`
		Message   string    `json:"message" gorm:"column:message"`
		Source    string    `json:"source" gorm:"column:source"`
	}
	var rows []row
	err := db.DB.Raw(`
		SELECT id::text, created_at, level, title, message, source
		FROM ops_alerts
		ORDER BY created_at DESC
		LIMIT ?
	`, limit).Scan(&rows).Error
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"alerts": []row{}, "note": "ops_alerts unavailable (run migration 000143)"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"alerts": rows, "count": len(rows)})
}

func parseGrafanaAlertPayload(body []byte) (title, message string, level alerts.Level) {
	title = "Grafana Alert"
	level = alerts.Warning
	message = string(body)
	if len(message) > 2000 {
		message = message[:2000] + "…"
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return title, message, level
	}
	if s, ok := payload["title"].(string); ok && strings.TrimSpace(s) != "" {
		title = s
	} else if s, ok := payload["commonLabels"].(map[string]interface{}); ok {
		if a, ok := s["alertname"].(string); ok && a != "" {
			title = a
		}
	}
	if s, ok := payload["state"].(string); ok && strings.EqualFold(s, "alerting") {
		level = alerts.Critical
	}
	if s, ok := payload["status"].(string); ok && strings.EqualFold(s, "firing") {
		level = alerts.Critical
	}
	if msg, ok := payload["message"].(string); ok && strings.TrimSpace(msg) != "" {
		message = msg
	} else if abs, ok := payload["alerts"].([]interface{}); ok && len(abs) > 0 {
		message = fmt.Sprintf("%d alert(s): %v", len(abs), abs[0])
		if len(message) > 2000 {
			message = message[:2000] + "…"
		}
	}
	return title, message, level
}
