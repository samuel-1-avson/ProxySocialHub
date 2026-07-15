package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/middleware"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterShowcaseRoutes registers provider showcase routes
func RegisterShowcaseRoutes(rg *gin.RouterGroup) {
	// Public routes
	rg.GET("/showcases/providers/:providerId", getProviderShowcases)
	rg.GET("/showcases/providers/:providerId/stats", getProviderStats)
	rg.GET("/showcases/providers/:providerId/testimonials", getProviderTestimonials)
	rg.GET("/showcases/providers/:providerId/speed-tests", getProviderSpeedTests)
	
	// Provider-only routes
	provider := rg.Group("/provider/showcase")
	provider.Use(middleware.RequireProviderRole())
	{
		provider.GET("", getMyShowcases)
		provider.POST("", createShowcase)
		provider.PUT("/:id", updateShowcase)
		provider.DELETE("/:id", deleteShowcase)
		provider.POST("/reorder", reorderShowcases)
		provider.POST("/speed-test", submitSpeedTest)
	}
	
	// Testimonials (for customers to submit)
	rg.POST("/testimonials", submitTestimonial)
}

func getProviderShowcases(c *gin.Context) {
	providerID, err := uuid.Parse(c.Param("providerId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid provider ID"})
		return
	}
	
	var showcases []models.ProviderShowcase
	db.Social().Where("provider_id = ? AND is_public = ?", providerID, true).
		Order("display_order ASC, created_at DESC").
		Find(&showcases)
	
	c.JSON(http.StatusOK, gin.H{"showcases": showcases})
}

func getProviderStats(c *gin.Context) {
	providerID, err := uuid.Parse(c.Param("providerId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid provider ID"})
		return
	}
	
	var stats models.ProviderStats
	if err := db.Social().First(&stats, "provider_id = ?", providerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"stats": nil})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{"stats": stats})
}

func getProviderTestimonials(c *gin.Context) {
	providerID, err := uuid.Parse(c.Param("providerId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid provider ID"})
		return
	}
	
	var testimonials []models.Testimonial
	db.Social().Where("provider_id = ? AND is_approved = ?", providerID, true).
		Order("is_featured DESC, created_at DESC").
		Preload("Customer").
		Find(&testimonials)
	
	c.JSON(http.StatusOK, gin.H{"testimonials": testimonials})
}

func getProviderSpeedTests(c *gin.Context) {
	providerID, err := uuid.Parse(c.Param("providerId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid provider ID"})
		return
	}
	
	var tests []models.SpeedTest
	db.Social().Where("provider_id = ? AND is_public = ?", providerID, true).
		Order("tested_at DESC").
		Limit(30).
		Find(&tests)
	
	c.JSON(http.StatusOK, gin.H{"speed_tests": tests})
}

func getMyShowcases(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	
	var showcases []models.ProviderShowcase
	db.Social().Where("provider_id = ?", userID).
		Order("display_order ASC, created_at DESC").
		Find(&showcases)
	
	c.JSON(http.StatusOK, gin.H{"showcases": showcases})
}

func createShowcase(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	
	var req struct {
		Title       string                 `json:"title" binding:"required"`
		Description string                 `json:"description"`
		Type        string                 `json:"type" binding:"required"`
		MediaURLs   []string               `json:"media_urls"`
		Metrics     map[string]interface{} `json:"metrics"`
		IsFeatured  bool                   `json:"is_featured"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	metricsJSON, _ := json.Marshal(req.Metrics)
	
	showcase := &models.ProviderShowcase{
		ProviderID:  userID.(uuid.UUID),
		Title:       req.Title,
		Description: req.Description,
		Type:        models.ShowcaseType(req.Type),
		MediaURLs:   req.MediaURLs,
		Metrics:     metricsJSON,
		IsFeatured:  req.IsFeatured,
	}
	
	if err := db.Social().Create(showcase).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	
	c.JSON(http.StatusCreated, showcase)
}

func updateShowcase(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	
	showcaseID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid showcase ID"})
		return
	}
	
	var showcase models.ProviderShowcase
	if err := db.Social().Where("id = ? AND provider_id = ?", showcaseID, userID).First(&showcase).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Showcase not found"})
		return
	}
	
	var req struct {
		Title       string                 `json:"title"`
		Description string                 `json:"description"`
		MediaURLs   []string               `json:"media_urls"`
		Metrics     map[string]interface{} `json:"metrics"`
		IsFeatured  *bool                  `json:"is_featured"`
		IsPublic    *bool                  `json:"is_public"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	updates := map[string]interface{}{}
	if req.Title != "" {
		updates["title"] = req.Title
	}
	if req.Description != "" {
		updates["description"] = req.Description
	}
	if req.MediaURLs != nil {
		updates["media_urls"] = req.MediaURLs
	}
	if req.Metrics != nil {
		metricsJSON, _ := json.Marshal(req.Metrics)
		updates["metrics"] = metricsJSON
	}
	if req.IsFeatured != nil {
		updates["is_featured"] = *req.IsFeatured
	}
	if req.IsPublic != nil {
		updates["is_public"] = *req.IsPublic
	}
	updates["updated_at"] = time.Now()
	
	if err := db.Social().Model(&showcase).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	
	c.JSON(http.StatusOK, showcase)
}

func deleteShowcase(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	
	showcaseID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid showcase ID"})
		return
	}
	
	result := db.Social().Where("id = ? AND provider_id = ?", showcaseID, userID).Delete(&models.ProviderShowcase{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Showcase not found"})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{"message": "showcase deleted"})
}

func reorderShowcases(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	
	var req struct {
		ShowcaseIDs []string `json:"showcase_ids" binding:"required"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	// Update display order
	for i, idStr := range req.ShowcaseIDs {
		id, err := uuid.Parse(idStr)
		if err != nil {
			continue
		}
		db.Social().Model(&models.ProviderShowcase{}).
			Where("id = ? AND provider_id = ?", id, userID).
			Update("display_order", i)
	}
	
	c.JSON(http.StatusOK, gin.H{"message": "showcases reordered"})
}

func submitSpeedTest(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	
	var req struct {
		DownloadSpeed float64 `json:"download_speed" binding:"required"`
		UploadSpeed   float64 `json:"upload_speed" binding:"required"`
		LatencyMs     int     `json:"latency_ms" binding:"required"`
		ServerLocation string `json:"server_location"`
		ProxyLocation  string `json:"proxy_location"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	test := &models.SpeedTest{
		ProviderID:     userID.(uuid.UUID),
		DownloadSpeed:  req.DownloadSpeed,
		UploadSpeed:    req.UploadSpeed,
		LatencyMs:      req.LatencyMs,
		ServerLocation: req.ServerLocation,
		ProxyLocation:  req.ProxyLocation,
		TestType:       "manual",
		TestMethod:     "user_submitted",
		IsPublic:       true,
		TestedAt:       time.Now(),
	}
	
	if err := db.Social().Create(test).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	
	c.JSON(http.StatusCreated, test)
}

func submitTestimonial(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	
	var req struct {
		ProviderID string  `json:"provider_id" binding:"required"`
		Content    string  `json:"content" binding:"required,min=10,max=1000"`
		Rating     int     `json:"rating" binding:"required,min=1,max=5"`
		OrderID    *string `json:"order_id"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	providerID, err := uuid.Parse(req.ProviderID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid provider ID"})
		return
	}
	
	testimonial := &models.Testimonial{
		ProviderID: providerID,
		CustomerID: ptrUUID(userID.(uuid.UUID)),
		Content:    req.Content,
		Rating:     req.Rating,
		IsVerified: req.OrderID != nil,
	}
	
	if req.OrderID != nil {
		orderID, err := uuid.Parse(*req.OrderID)
		if err == nil {
			testimonial.OrderID = &orderID
		}
	}
	
	if err := db.Social().Create(testimonial).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	
	c.JSON(http.StatusCreated, testimonial)
}

func ptrUUID(u uuid.UUID) *uuid.UUID {
	return &u
}
