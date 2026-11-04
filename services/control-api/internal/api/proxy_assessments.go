package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/quality"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func createProxyAssessment(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	var req struct {
		ProviderNodeID uuid.UUID `json:"provider_node_id" binding:"required"`
		quality.Configuration
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Choose a node and provide the offer configuration"})
		return
	}
	if quality.BasePrice(req.ProxyType) == 0 || req.MaxConcurrency < 1 || req.MaxConcurrency > 100 || (req.RotationType != "sticky" && req.RotationType != "static" && req.RotationType != "rotating") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid proxy type, rotation or concurrency"})
		return
	}
	protocol, problem := normalizeListingProtocols(req.Protocol)
	if problem != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": problem})
		return
	}
	req.Protocol = protocol
	var assessment models.ProxyAssessment
	err := db.DB.Transaction(func(tx *gorm.DB) error {
		var node models.ProviderNode
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", req.ProviderNodeID, userID).First(&node).Error; err != nil {
			return err
		}
		var pending models.ProxyAssessment
		if err := tx.Where("provider_node_id = ? AND status IN ?", node.ID, []string{"queued", "running"}).First(&pending).Error; err == nil {
			assessment = pending
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var recent int64
		if err := tx.Model(&models.ProxyAssessment{}).Where("provider_node_id = ? AND created_at > ?", node.ID, time.Now().Add(-time.Minute)).Count(&recent).Error; err != nil {
			return err
		}
		if recent > 0 {
			return errAssessmentCooldown
		}
		assessment = models.ProxyAssessment{ID: uuid.New(), SellerID: userID, ProviderNodeID: node.ID, ConfigurationHash: quality.Fingerprint(node, req.Configuration), ProxyType: req.ProxyType, Protocol: req.Protocol, RotationType: req.RotationType, Country: req.Country, MaxConcurrency: req.MaxConcurrency, Status: "queued", PolicyVersion: quality.PolicyVersion, Tier: "Unassessed", Provisional: true, CreatedAt: time.Now().UTC()}
		return tx.Create(&assessment).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
		return
	}
	if errors.Is(err, errAssessmentCooldown) {
		c.Header("Retry-After", "60")
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Wait one minute before reassessing this node"})
		return
	}
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Could not queue assessment"})
		return
	}
	c.JSON(http.StatusAccepted, assessment)
}

var errAssessmentCooldown = errors.New("assessment cooldown")

func getProxyAssessment(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid assessment ID"})
		return
	}
	var assessment models.ProxyAssessment
	if err := db.DB.Where("id = ? AND seller_id = ?", id, userID).First(&assessment).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Assessment not found"})
		return
	}
	if (assessment.Status == "queued" && time.Since(assessment.CreatedAt) > 15*time.Minute) || (assessment.Status == "running" && assessment.StartedAt != nil && time.Since(*assessment.StartedAt) > 2*time.Minute) {
		completed := time.Now().UTC()
		result := db.DB.Model(&models.ProxyAssessment{}).Where("id = ? AND status IN ?", assessment.ID, []string{"queued", "running"}).Updates(map[string]interface{}{"status": "unavailable", "completed_at": completed, "summary": "Assessment did not finish. Retry when the worker is available; no quality conclusion was made."})
		if result.Error == nil {
			db.DB.First(&assessment, "id = ?", assessment.ID)
		}
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, assessment)
}
