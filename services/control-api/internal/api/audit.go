package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/security"
)

var (
	auditService    *security.AuditService
	anomalyDetector *security.AnomalyDetector
)

func init() {
	auditService = security.NewAuditService()
	anomalyDetector = security.NewAnomalyDetector(auditService)
}

// RegisterAuditRoutes registers audit and security monitoring endpoints
func RegisterAuditRoutes(r *gin.RouterGroup) {
	audit := r.Group("/audit")
	{
		// User-facing endpoints
		audit.GET("/logs", getMyAuditLogs)
		audit.GET("/anomalies", getMyAnomalies)
		audit.POST("/anomalies/:id/resolve", resolveAnomaly)
	}

	// Admin-only endpoints
	admin := r.Group("/admin/audit")
	admin.Use(RequireRole("admin"))
	{
		admin.GET("/logs", getAllAuditLogs)
		admin.GET("/alerts", getSecurityAlerts)
		admin.GET("/anomalies", getAllAnomalies)
		admin.GET("/stats", getAuditStats)
	}
}

// ==================== User Endpoints ====================

// @Summary Get my audit logs
// @Tags audit
// @Produce json
// @Param limit query int false "Limit results"
// @Success 200 {array} models.AuditLog
// @Router /v1/audit/logs [get]
func getMyAuditLogs(c *gin.Context) {
	userID := c.MustGet("user_id").(uuid.UUID)
	limit := getIntParam(c, "limit", 50)

	logs, err := auditService.GetUserAuditLogs(userID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get logs"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"logs": logs, "count": len(logs)})
}

// anomalyListItem is the unified API shape for login/session anomalies and wallet user_flags.
type anomalyListItem struct {
	ID               string  `json:"id"`
	AnomalyType      string  `json:"anomaly_type"`
	Severity         string  `json:"severity"`
	DetectedIP       string  `json:"detected_ip"`
	DetectedCountry  string  `json:"detected_country"`
	DetectedCity     string  `json:"detected_city"`
	ExpectedCountry  string  `json:"expected_country"`
	RiskScore        float64 `json:"risk_score"`
	ActionTaken      string  `json:"action_taken"`
	IsResolved       bool    `json:"is_resolved"`
	ResolvedAt       *time.Time `json:"resolved_at"`
	Resolution       string  `json:"resolution"`
	CreatedAt        time.Time `json:"created_at"`
	Source           string  `json:"source"` // security_anomaly | account_flag
}

func securityAnomalyToItem(a models.SecurityAnomaly) anomalyListItem {
	return anomalyListItem{
		ID:              a.ID.String(),
		AnomalyType:     a.AnomalyType,
		Severity:        a.Severity,
		DetectedIP:      a.DetectedIP,
		DetectedCountry: a.DetectedCountry,
		DetectedCity:    a.DetectedCity,
		ExpectedCountry: a.ExpectedCountry,
		RiskScore:       a.RiskScore,
		ActionTaken:     a.ActionTaken,
		IsResolved:      a.IsResolved,
		ResolvedAt:      a.ResolvedAt,
		Resolution:      a.Resolution,
		CreatedAt:       a.CreatedAt,
		Source:          "security_anomaly",
	}
}

func userFlagToAnomalyItem(f models.UserFlag) anomalyListItem {
	severity := "high"
	switch f.FlagType {
	case "excessive_withdrawals", "large_withdrawal_deviation", "large_new_p2p_transfer":
		severity = "critical"
	case "excessive_usage_spend":
		severity = "medium"
	}
	resolution := ""
	if f.Resolved && f.Reason != "" {
		resolution = f.Reason
	}
	return anomalyListItem{
		ID:              f.ID.String(),
		AnomalyType:     f.FlagType,
		Severity:        severity,
		DetectedIP:      "system",
		DetectedCountry: "",
		DetectedCity:    "",
		RiskScore:       85,
		ActionTaken:     "withdrawals_frozen",
		IsResolved:      f.Resolved,
		ResolvedAt:      f.ResolvedAt,
		Resolution:      resolution,
		CreatedAt:       f.CreatedAt,
		Source:          "account_flag",
	}
}

// @Summary Get my security anomalies
// @Tags audit
// @Produce json
// @Param limit query int false "Limit results"
// @Success 200 {array} models.SecurityAnomaly
// @Router /v1/audit/anomalies [get]
func getMyAnomalies(c *gin.Context) {
	userID := c.MustGet("user_id").(uuid.UUID)
	limit := getIntParam(c, "limit", 20)

	securityRows, err := anomalyDetector.GetUserAnomalies(userID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get anomalies"})
		return
	}

	var flags []models.UserFlag
	db.DB.Where("user_id = ?", userID).Order("created_at DESC").Limit(limit).Find(&flags)

	combined := make([]anomalyListItem, 0, len(securityRows)+len(flags))
	for _, a := range securityRows {
		combined = append(combined, securityAnomalyToItem(a))
	}
	for _, f := range flags {
		combined = append(combined, userFlagToAnomalyItem(f))
	}

	c.JSON(http.StatusOK, gin.H{"anomalies": combined, "count": len(combined)})
}

// @Summary Resolve an anomaly
// @Tags audit
// @Accept json
// @Produce json
// @Param id path string true "Anomaly ID"
// @Param request body struct{Resolution string} true "Resolution"
// @Success 200 {object} gin.H
// @Router /v1/audit/anomalies/{id}/resolve [post]
func resolveAnomaly(c *gin.Context) {
	userID := c.MustGet("user_id").(uuid.UUID)
	anomalyIDStr := c.Param("id")

	anomalyID, err := uuid.Parse(anomalyIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid anomaly ID"})
		return
	}

	var req struct {
		Resolution string `json:"resolution" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var anomaly models.SecurityAnomaly
	if err := db.DB.Where("id = ? AND user_id = ?", anomalyID, userID).First(&anomaly).Error; err == nil {
		if err := anomalyDetector.ResolveAnomaly(anomalyID, userID, req.Resolution); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to resolve"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Anomaly resolved"})
		return
	}

	var flag models.UserFlag
	if err := db.DB.Where("id = ? AND user_id = ?", anomalyID, userID).First(&flag).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Anomaly not found"})
		return
	}

	now := time.Now()
	if err := db.DB.Model(&flag).Updates(map[string]interface{}{
		"resolved":    true,
		"resolved_at": now,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to resolve"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Security flag resolved"})
}

// ==================== Admin Endpoints ====================

// @Summary Get all audit logs (admin)
// @Tags admin-audit
// @Produce json
// @Param event_type query string false "Filter by event type"
// @Param severity query string false "Filter by severity"
// @Param limit query int false "Limit results"
// @Success 200 {array} models.AuditLog
// @Router /v1/admin/audit/logs [get]
func getAllAuditLogs(c *gin.Context) {
	limit := getIntParam(c, "limit", 100)
	eventType := c.Query("event_type")
	severity := c.Query("severity")

	query := db.DB.Model(&models.AuditLog{})

	if eventType != "" {
		query = query.Where("event_type = ?", eventType)
	}
	if severity != "" {
		query = query.Where("severity = ?", severity)
	}

	var logs []models.AuditLog
	if err := query.Order("created_at DESC").Limit(limit).Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get logs"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"logs": logs, "count": len(logs)})
}

// @Summary Get security alerts (admin)
// @Tags admin-audit
// @Produce json
// @Param hours query int false "Hours to look back"
// @Success 200 {array} models.AuditLog
// @Router /v1/admin/audit/alerts [get]
func getSecurityAlerts(c *gin.Context) {
	hours := getIntParam(c, "hours", 24)
	since := time.Now().Add(-time.Duration(hours) * time.Hour)

	alerts, err := auditService.GetSecurityAlerts(since)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get alerts"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"alerts": alerts, "count": len(alerts), "since": since})
}

// @Summary Get all anomalies (admin)
// @Tags admin-audit
// @Produce json
// @Param resolved query bool false "Filter by resolution status"
// @Param severity query string false "Filter by severity"
// @Param limit query int false "Limit results"
// @Success 200 {array} models.SecurityAnomaly
// @Router /v1/admin/audit/anomalies [get]
func getAllAnomalies(c *gin.Context) {
	limit := getIntParam(c, "limit", 50)
	severity := c.Query("severity")

	query := db.DB.Model(&models.SecurityAnomaly{})

	if resolvedStr := c.Query("resolved"); resolvedStr != "" {
		resolved := resolvedStr == "true"
		query = query.Where("is_resolved = ?", resolved)
	}
	if severity != "" {
		query = query.Where("severity = ?", severity)
	}

	var anomalies []models.SecurityAnomaly
	if err := query.Order("created_at DESC").Limit(limit).Find(&anomalies).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get anomalies"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"anomalies": anomalies, "count": len(anomalies)})
}

// @Summary Get audit statistics (admin)
// @Tags admin-audit
// @Produce json
// @Success 200 {object} gin.H
// @Router /v1/admin/audit/stats [get]
func getAuditStats(c *gin.Context) {
	now := time.Now()
	last24h := now.Add(-24 * time.Hour)
	last7d := now.Add(-7 * 24 * time.Hour)

	// Count events by severity
	var stats struct {
		Total24h       int64
		Critical24h    int64
		Warning24h     int64
		FailedLogins7d int64
		Anomalies7d    int64
		Lockouts7d     int64
	}

	db.DB.Model(&models.AuditLog{}).Where("created_at > ?", last24h).Count(&stats.Total24h)
	db.DB.Model(&models.AuditLog{}).Where("created_at > ? AND severity = ?", last24h, "critical").Count(&stats.Critical24h)
	db.DB.Model(&models.AuditLog{}).Where("created_at > ? AND severity = ?", last24h, "warning").Count(&stats.Warning24h)
	db.DB.Model(&models.AuditLog{}).Where("created_at > ? AND event_type = ?", last7d, models.AuditAuthLoginFailed).Count(&stats.FailedLogins7d)
	db.DB.Model(&models.SecurityAnomaly{}).Where("created_at > ?", last7d).Count(&stats.Anomalies7d)
	db.DB.Model(&models.AuditLog{}).Where("created_at > ? AND event_type = ?", last7d, models.AuditSecurityLockout).Count(&stats.Lockouts7d)

	// Get event type breakdown
	var eventBreakdown []struct {
		EventType string
		Count     int64
	}
	db.DB.Model(&models.AuditLog{}).
		Select("event_type, count(*) as count").
		Where("created_at > ?", last24h).
		Group("event_type").
		Order("count DESC").
		Limit(10).
		Find(&eventBreakdown)

	c.JSON(http.StatusOK, gin.H{
		"period": "24h",
		"stats": gin.H{
			"total_events":     stats.Total24h,
			"critical_events":  stats.Critical24h,
			"warning_events":   stats.Warning24h,
			"failed_logins_7d": stats.FailedLogins7d,
			"anomalies_7d":     stats.Anomalies7d,
			"lockouts_7d":      stats.Lockouts7d,
		},
		"event_breakdown": eventBreakdown,
	})
}

// Helper function
func getIntParam(c *gin.Context, name string, defaultVal int) int {
	val := c.Query(name)
	if val == "" {
		return defaultVal
	}
	var i int
	if _, err := parseIntHelper(val, &i); err != nil {
		return defaultVal
	}
	return i
}
