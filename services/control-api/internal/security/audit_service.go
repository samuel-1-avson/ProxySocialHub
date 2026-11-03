package security

import (
	"encoding/json"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// AuditService handles comprehensive event logging
type AuditService struct {
	db *gorm.DB
}

// NewAuditService creates a new audit service
func NewAuditService() *AuditService {
	return &AuditService{}
}

// conn returns the database handle. The api package builds this service in
// init(), before main connects the database, so db.DB is read on each call
// instead of being copied at construction (a copy would stay nil forever).
func (a *AuditService) conn() *gorm.DB {
	if a.db != nil {
		return a.db
	}
	return db.DB
}

// LogEvent records an audit event
func (a *AuditService) LogEvent(event models.AuditLog) error {
	return a.conn().Create(&event).Error
}

// LogAuth logs authentication-related events
func (a *AuditService) LogAuth(
	eventType models.AuditEventType,
	actorID *uuid.UUID,
	ip, userAgent string,
	success bool,
	description string,
	metadata map[string]interface{},
) {
	metadataJSON := ""
	if metadata != nil {
		data, _ := json.Marshal(metadata)
		metadataJSON = string(data)
	}

	severity := models.AuditSeverityInfo
	if !success {
		severity = models.AuditSeverityWarning
	}
	if eventType == models.AuditAuthMFADisabled || eventType == models.AuditSecurityLockout {
		severity = models.AuditSeverityCritical
	}

	event := models.AuditLog{
		EventType:   eventType,
		Severity:    severity,
		ActorID:     actorID,
		ActorType:   "user",
		IPAddress:   ip,
		UserAgent:   userAgent,
		Description: description,
		Metadata:    metadataJSON,
		Success:     success,
	}

	if err := a.LogEvent(event); err != nil {
		log.Printf("[AUDIT] Failed to log event: %v", err)
	}
}

// LogUserAction logs user-related events
func (a *AuditService) LogUserAction(
	eventType models.AuditEventType,
	actorID uuid.UUID,
	targetID string,
	ip string,
	description string,
	metadata map[string]interface{},
) {
	metadataJSON := ""
	if metadata != nil {
		data, _ := json.Marshal(metadata)
		metadataJSON = string(data)
	}

	event := models.AuditLog{
		EventType:   eventType,
		Severity:    models.AuditSeverityInfo,
		ActorID:     &actorID,
		ActorType:   "user",
		TargetType:  "user",
		TargetID:    targetID,
		IPAddress:   ip,
		Description: description,
		Metadata:    metadataJSON,
		Success:     true,
	}

	a.LogEvent(event)
}

// LogSecurityEvent logs security-related events
func (a *AuditService) LogSecurityEvent(
	eventType models.AuditEventType,
	severity models.AuditSeverity,
	actorID *uuid.UUID,
	ip string,
	description string,
	metadata map[string]interface{},
) {
	metadataJSON := ""
	if metadata != nil {
		data, _ := json.Marshal(metadata)
		metadataJSON = string(data)
	}

	event := models.AuditLog{
		EventType:   eventType,
		Severity:    severity,
		ActorID:     actorID,
		ActorType:   "system",
		IPAddress:   ip,
		Description: description,
		Metadata:    metadataJSON,
		Success:     true,
	}

	if err := a.LogEvent(event); err != nil {
		log.Printf("[AUDIT] Failed to log security event: %v", err)
	}
}

// GetUserAuditLogs retrieves audit logs for a user
func (a *AuditService) GetUserAuditLogs(userID uuid.UUID, limit int) ([]models.AuditLog, error) {
	var logs []models.AuditLog
	err := a.conn().Where("actor_id = ?", userID).
		Order("created_at DESC").
		Limit(limit).
		Find(&logs).Error
	return logs, err
}

// GetSecurityAlerts retrieves security-related events
func (a *AuditService) GetSecurityAlerts(since time.Time) ([]models.AuditLog, error) {
	var logs []models.AuditLog
	err := a.conn().Where("severity IN (?, ?) AND created_at > ?",
		models.AuditSeverityWarning, models.AuditSeverityCritical, since).
		Order("created_at DESC").
		Find(&logs).Error
	return logs, err
}

// AnomalyDetector detects suspicious login patterns
type AnomalyDetector struct {
	db           *gorm.DB
	auditService *AuditService
}

// NewAnomalyDetector creates a new anomaly detector
func NewAnomalyDetector(auditService *AuditService) *AnomalyDetector {
	return &AnomalyDetector{
		auditService: auditService,
	}
}

// conn returns the database handle; see AuditService.conn.
func (d *AnomalyDetector) conn() *gorm.DB {
	if d.db != nil {
		return d.db
	}
	return db.DB
}

// AnomalyCheckResult contains detection results
type AnomalyCheckResult struct {
	HasAnomaly  bool
	AnomalyType string
	Severity    string
	RiskScore   float64
	Action      string // none, alert, require_mfa, block
	Description string
}

// CheckLogin analyzes a login attempt for anomalies
func (d *AnomalyDetector) CheckLogin(userID uuid.UUID, ip, userAgent, country, city string) AnomalyCheckResult {
	result := AnomalyCheckResult{
		RiskScore: 0,
		Action:    "none",
	}

	// Get recent sessions for comparison
	var recentSessions []models.UserSession
	d.conn().Where("user_id = ? AND created_at > ?", userID, time.Now().Add(-30*24*time.Hour)).
		Order("created_at DESC").
		Limit(10).
		Find(&recentSessions)

	if len(recentSessions) == 0 {
		// First login - no baseline
		return result
	}

	// Check for geographic anomaly
	lastSession := recentSessions[0]
	geoAnomaly := d.checkGeoAnomaly(lastSession, country)
	if geoAnomaly > 0 {
		result.RiskScore += geoAnomaly
		result.HasAnomaly = true
		result.AnomalyType = "geo_change"
		result.Description = "Login from new country"
	}

	// Check for device change
	deviceAnomaly := d.checkDeviceAnomaly(recentSessions, userAgent)
	if deviceAnomaly > 0 {
		result.RiskScore += deviceAnomaly
		result.HasAnomaly = true
		if result.AnomalyType != "" {
			result.AnomalyType += ",device_change"
		} else {
			result.AnomalyType = "device_change"
		}
		result.Description += " New device detected."
	}

	// Check for velocity (too many logins in short time)
	velocityAnomaly := d.checkVelocity(userID)
	if velocityAnomaly > 0 {
		result.RiskScore += velocityAnomaly
		result.HasAnomaly = true
		if result.AnomalyType != "" {
			result.AnomalyType += ",velocity"
		} else {
			result.AnomalyType = "velocity"
		}
		result.Description += " High login frequency."
	}

	// Check for impossible travel
	travelAnomaly := d.checkImpossibleTravel(lastSession, ip, country)
	if travelAnomaly > 0 {
		result.RiskScore += travelAnomaly
		result.HasAnomaly = true
		if result.AnomalyType != "" {
			result.AnomalyType += ",impossible_travel"
		} else {
			result.AnomalyType = "impossible_travel"
		}
		result.Description += " Impossible travel detected."
	}

	// Determine severity and action based on risk score
	if result.RiskScore >= 80 {
		result.Severity = "critical"
		result.Action = "block"
	} else if result.RiskScore >= 60 {
		result.Severity = "high"
		result.Action = "require_mfa"
	} else if result.RiskScore >= 40 {
		result.Severity = "medium"
		result.Action = "alert"
	} else if result.RiskScore >= 20 {
		result.Severity = "low"
		result.Action = "alert"
	}

	// Record anomaly if detected
	if result.HasAnomaly && result.RiskScore >= 20 {
		d.recordAnomaly(userID, result, ip, userAgent, country, city, lastSession)
	}

	return result
}

func (d *AnomalyDetector) checkGeoAnomaly(lastSession models.UserSession, newCountry string) float64 {
	if lastSession.Country == "" || newCountry == "" {
		return 0
	}
	if lastSession.Country != newCountry {
		return 30 // New country = 30 points
	}
	return 0
}

func (d *AnomalyDetector) checkDeviceAnomaly(sessions []models.UserSession, newUA string) float64 {
	// Check if this device has been seen before
	newFingerprint := generateFingerprint("", newUA)

	for _, s := range sessions {
		if s.Fingerprint == newFingerprint || s.UserAgent == newUA {
			return 0 // Known device
		}
	}
	return 20 // New device = 20 points
}

func (d *AnomalyDetector) checkVelocity(userID uuid.UUID) float64 {
	// Count logins in last hour
	var count int64
	d.conn().Model(&models.UserSession{}).
		Where("user_id = ? AND created_at > ?", userID, time.Now().Add(-1*time.Hour)).
		Count(&count)

	if count > 10 {
		return 40 // Too many logins = 40 points
	} else if count > 5 {
		return 20
	}
	return 0
}

func (d *AnomalyDetector) checkImpossibleTravel(lastSession models.UserSession, newIP, newCountry string) float64 {
	// If different country within 1 hour, it's suspicious
	timeSinceLast := time.Since(lastSession.CreatedAt)

	if lastSession.Country != "" && newCountry != "" &&
		lastSession.Country != newCountry &&
		timeSinceLast < 2*time.Hour {
		return 50 // Impossible travel = 50 points
	}
	return 0
}

func (d *AnomalyDetector) recordAnomaly(
	userID uuid.UUID,
	result AnomalyCheckResult,
	ip, userAgent, country, city string,
	lastSession models.UserSession,
) {
	anomaly := models.SecurityAnomaly{
		UserID:          userID,
		AnomalyType:     result.AnomalyType,
		Severity:        result.Severity,
		DetectedIP:      ip,
		DetectedUA:      userAgent,
		DetectedCountry: country,
		DetectedCity:    city,
		ExpectedIP:      lastSession.IPAddress,
		ExpectedCountry: lastSession.Country,
		RiskScore:       result.RiskScore,
		ActionTaken:     result.Action,
	}

	details, _ := json.Marshal(map[string]interface{}{
		"description": result.Description,
		"risk_score":  result.RiskScore,
	})
	anomaly.Details = string(details)

	if err := d.conn().Create(&anomaly).Error; err != nil {
		log.Printf("[ANOMALY] Failed to record: %v", err)
	}

	// Log to audit
	d.auditService.LogSecurityEvent(
		models.AuditSecurityAnomaly,
		models.AuditSeverity(result.Severity),
		&userID,
		ip,
		result.Description,
		map[string]interface{}{
			"anomaly_type": result.AnomalyType,
			"risk_score":   result.RiskScore,
			"action":       result.Action,
		},
	)
}

// GetUserAnomalies returns anomalies for a user
func (d *AnomalyDetector) GetUserAnomalies(userID uuid.UUID, limit int) ([]models.SecurityAnomaly, error) {
	var anomalies []models.SecurityAnomaly
	err := d.conn().Where("user_id = ?", userID).
		Order("created_at DESC").
		Limit(limit).
		Find(&anomalies).Error
	return anomalies, err
}

// ResolveAnomaly marks an anomaly as resolved
func (d *AnomalyDetector) ResolveAnomaly(anomalyID, resolvedBy uuid.UUID, resolution string) error {
	now := time.Now()
	return d.conn().Model(&models.SecurityAnomaly{}).
		Where("id = ?", anomalyID).
		Updates(map[string]interface{}{
			"is_resolved": true,
			"resolved_by": resolvedBy,
			"resolved_at": now,
			"resolution":  resolution,
		}).Error
}
