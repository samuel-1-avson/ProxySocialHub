package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterCircleRoutes registers all circle-related API routes
func RegisterCircleRoutes(rg *gin.RouterGroup) {
	circles := rg.Group("/circles")
	{
		circles.POST("/", createCircle)
		circles.GET("/", listCircles)
		circles.GET("/:id", getCircle)
		circles.POST("/:id/join", joinCircle)
		circles.POST("/:id/invite", inviteToCircle)
		circles.DELETE("/:id/members/me", leaveCircle) // Using standard REST pattern for "leaving"
		circles.GET("/:id/members", getCircleMembers)
		circles.GET("/:id/stats", getCircleStats)
		circles.DELETE("/:id", deleteCircle)
		circles.PUT("/:id", updateCircle)

		// Enterprise features
		circles.POST("/:id/enterprise", upgradeToEnterprise)
		circles.GET("/:id/sla", getCircleSLA)
		circles.PUT("/:id/sla", updateCircleSLA)
		circles.POST("/:id/lease", createCircleLease)
		circles.GET("/:id/leases", getCircleLeases)
	}
}

// CreateCircleRequest represents the request body for creating a circle
type CreateCircleRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	Visibility  string `json:"visibility"` // "public" or "private"
}

// createCircle creates a new provider circle
func createCircle(c *gin.Context) {
	var req CreateCircleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Default visibility to private
	visibility := req.Visibility
	if visibility == "" {
		visibility = "private"
	}

	// Get user ID from JWT token
	currentUserID, _ := c.Get("user_id")
	userID, _ := uuid.Parse(currentUserID.(string))

	circle := models.NewCircle(req.Name, req.Description, userID, visibility)

	// Save to database
	if db.DB != nil {
		if err := db.DB.Create(circle).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create circle"})
			return
		}

		// Add owner as member
		member := models.NewCircleMember(circle.ID, userID, "owner")
		if err := db.DB.Create(member).Error; err != nil {
			// Log but don't fail
			println("Warning: Failed to add owner as member:", err.Error())
		}
	}

	c.JSON(http.StatusCreated, gin.H{
		"circle":  circle,
		"message": "Circle created successfully",
	})
}

// listCircles returns all circles the user can access
func listCircles(c *gin.Context) {
	var circles []models.Circle

	if db.DB != nil {
		// Get public circles and circles user is member of
		// For now, just get all public circles
		if err := db.DB.Where("visibility = ?", "public").Find(&circles).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch circles"})
			return
		}
	} else {
		// Mock data for testing
		circles = []models.Circle{
			// Mocks removed for brevity/consistency
		}
	}

	c.JSON(http.StatusOK, gin.H{"circles": circles})
}

// getCircle returns details of a specific circle
func getCircle(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}

	var circle models.Circle
	if err := db.DB.First(&circle, "id = ?", circleID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Circle not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"circle": circle})
}

// JoinCircleRequest represents a request to join a circle
type JoinCircleRequest struct {
	Message string `json:"message"` // Optional message for join request
}

// joinCircle handles a request to join a circle
func joinCircle(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}

	// Get user ID from JWT token
	currentUserID, _ := c.Get("user_id")
	userID, _ := uuid.Parse(currentUserID.(string))

	var circle models.Circle
	if err := db.DB.First(&circle, "id = ?", circleID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Circle not found"})
		return
	}

	// Check if already a member
	var existingMember models.CircleMember
	if err := db.DB.Where("circle_id = ? AND user_id = ?", circleID, userID).First(&existingMember).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Already a member of this circle"})
		return
	}

	// Create membership
	status := "active"
	if circle.Visibility == "private" {
		status = "pending" // Requires approval for private circles
	}

	member := models.NewCircleMember(circleID, userID, "member")
	member.Status = status

	if err := db.DB.Create(member).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to join circle"})
		return
	}

	// Update member count
	db.DB.Model(&circle).Update("member_count", circle.MemberCount+1)

	c.JSON(http.StatusOK, gin.H{
		"message":   "Successfully joined circle",
		"circle_id": circleID,
	})
}

// InviteRequest represents an invitation to join a circle
type InviteRequest struct {
	UserID uuid.UUID `json:"user_id" binding:"required"`
}

// inviteToCircle invites a user to join a private circle
func inviteToCircle(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}

	var req InviteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user ID from JWT token (verify permission in production)
	currentUserID, _ := c.Get("user_id")
	inviterID, _ := uuid.Parse(currentUserID.(string))

	invite := &models.CircleInvite{
		ID:        uuid.New(),
		CircleID:  circleID,
		InviterID: inviterID,
		InviteeID: req.UserID,
		Status:    "pending",
		ExpiresAt: time.Now().Add(7 * 24 * time.Hour), // 7 day expiry
		CreatedAt: time.Now(),
	}

	if err := db.DB.Create(invite).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create invite"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":   "Invitation sent",
		"invite_id": invite.ID,
	})
}

// getCircleMembers returns members of a circle
func getCircleMembers(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}

	var members []models.CircleMember
	if err := db.DB.Where("circle_id = ? AND status = ?", circleID, "active").Preload("User").Find(&members).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch members"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"circle_id": circleID,
		"members":   members,
		"count":     len(members),
	})
}

// getCircleStats returns statistics for a circle
func getCircleStats(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}

	// In production, this would aggregate from usage and node tables
	stats := models.CircleStats{
		CircleID:     circleID,
		Name:         "Circle Stats",
		MemberCount:  5,
		TotalBytesGB: 125.5,
		TotalRevenue: 450.75,
		AvgUptime:    98.5,
		ActiveNodes:  4,
		Last7DaysGB:  45.2,
		Last30DaysGB: 125.5,
	}

	var circle models.Circle
	if err := db.DB.First(&circle, "id = ?", circleID).Error; err == nil {
		stats.Name = circle.Name
		stats.MemberCount = circle.MemberCount
	}

	c.JSON(http.StatusOK, gin.H{"stats": stats})
}

// updateCircle updates circle details
func updateCircle(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}
	currentUserID, _ := c.Get("user_id")
	userID, _ := uuid.Parse(currentUserID.(string))

	var req CreateCircleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var circle models.Circle
	if err := db.DB.First(&circle, "id = ?", circleID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Circle not found"})
		return
	}

	if circle.OwnerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the owner can update the circle"})
		return
	}

	circle.Name = req.Name
	circle.Description = req.Description
	if req.Visibility != "" {
		circle.Visibility = req.Visibility
	}
	circle.UpdatedAt = time.Now()

	if err := db.DB.Save(&circle).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update circle"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"circle": circle, "message": "Circle updated"})
}

// deleteCircle deletes a circle
func deleteCircle(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}
	currentUserID, _ := c.Get("user_id")
	userID, _ := uuid.Parse(currentUserID.(string))

	var circle models.Circle
	if err := db.DB.First(&circle, "id = ?", circleID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Circle not found"})
		return
	}

	if circle.OwnerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the owner can delete the circle"})
		return
	}

	// Delete logic - soft delete or hard delete?
	// Using hard delete for now to simplify cleanup
	if err := db.DB.Delete(&circle).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete circle"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Circle deleted"})
}

// leaveCircle removes the current user from the circle
func leaveCircle(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}
	currentUserID, _ := c.Get("user_id")
	userID, _ := uuid.Parse(currentUserID.(string))

	var circle models.Circle
	if err := db.DB.First(&circle, "id = ?", circleID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Circle not found"})
		return
	}

	if circle.OwnerID == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Owner cannot leave the circle. Delete it or transfer ownership."})
		return
	}

	// db.DB.Where("circle_id = ? AND user_id = ?", circleID, userID).Delete(&models.CircleMember{})
	// Soft delete preferable
	var member models.CircleMember
	if err := db.DB.Where("circle_id = ? AND user_id = ?", circleID, userID).First(&member).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Member not found"})
		return
	}

	if err := db.DB.Delete(&member).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to leave circle"})
		return
	}

	// Decrement count
	db.DB.Model(&circle).Update("member_count", circle.MemberCount-1)

	c.JSON(http.StatusOK, gin.H{"message": "Left circle"})
}

// ========== Enterprise Circle Features ==========

type UpgradeEnterpriseRequest struct {
	BandwidthPoolGB float64 `json:"bandwidth_pool_gb" binding:"required,min=10"`
	PricePerGB      float64 `json:"price_per_gb"`
	PriorityLevel   int     `json:"priority_level"`
}

// upgradeToEnterprise upgrades a circle to enterprise tier
func upgradeToEnterprise(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}
	currentUserID, _ := c.Get("user_id")
	userID, _ := uuid.Parse(currentUserID.(string))

	var req UpgradeEnterpriseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var circle models.Circle
	if result := db.DB.First(&circle, "id = ?", circleID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Circle not found"})
		return
	}

	// Verify ownership
	if circle.OwnerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the owner can upgrade to enterprise"})
		return
	}

	// Apply enterprise settings
	circle.IsEnterprise = true
	circle.BandwidthPoolGB = req.BandwidthPoolGB
	if req.PricePerGB > 0 {
		circle.PricePerGB = req.PricePerGB
	} else {
		circle.PricePerGB = 0.50 // Default
	}
	if req.PriorityLevel > 0 && req.PriorityLevel <= 5 {
		circle.PriorityLevel = req.PriorityLevel
	} else {
		circle.PriorityLevel = 2 // Default enterprise priority
	}
	circle.UpdatedAt = time.Now()

	if result := db.DB.Save(&circle); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upgrade circle"})
		return
	}

	// Create default SLA
	sla := models.NewCircleSLA(circleID)
	db.DB.Create(sla)

	c.JSON(http.StatusOK, gin.H{
		"message": "Circle upgraded to enterprise",
		"circle":  circle,
		"sla":     sla,
	})
}

// getCircleSLA returns the SLA configuration for a circle
func getCircleSLA(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}

	var sla models.CircleSLA
	if result := db.DB.Where("circle_id = ?", circleID).First(&sla); result.Error != nil {
		// Return default SLA if none exists
		sla = *models.NewCircleSLA(circleID)
	}

	c.JSON(http.StatusOK, gin.H{"sla": sla})
}

type UpdateSLARequest struct {
	UptimeGuarantee  float64 `json:"uptime_guarantee"`
	MaxLatencyMs     int     `json:"max_latency_ms"`
	MinSuccessRate   float64 `json:"min_success_rate"`
	SupportTier      string  `json:"support_tier"`
	MaxConcurrency   int     `json:"max_concurrency"`
	IncidentResponse int     `json:"incident_response_mins"`
}

// updateCircleSLA updates the SLA configuration
func updateCircleSLA(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}
	currentUserID, _ := c.Get("user_id")
	userID, _ := uuid.Parse(currentUserID.(string))

	var req UpdateSLARequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify circle ownership
	var circle models.Circle
	if result := db.DB.First(&circle, "id = ?", circleID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Circle not found"})
		return
	}

	if circle.OwnerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the owner can update SLA"})
		return
	}

	if !circle.IsEnterprise {
		c.JSON(http.StatusBadRequest, gin.H{"error": "SLA configuration requires enterprise tier"})
		return
	}

	// Get or create SLA
	var sla models.CircleSLA
	if db.DB.Where("circle_id = ?", circleID).First(&sla).Error != nil {
		sla = *models.NewCircleSLA(circleID)
	}

	// Update fields
	if req.UptimeGuarantee > 0 {
		sla.UptimeGuarantee = req.UptimeGuarantee
	}
	if req.MaxLatencyMs > 0 {
		sla.MaxLatencyMs = req.MaxLatencyMs
	}
	if req.MinSuccessRate > 0 {
		sla.MinSuccessRate = req.MinSuccessRate
	}
	if req.SupportTier != "" {
		sla.SupportTier = req.SupportTier
	}
	if req.MaxConcurrency > 0 {
		sla.MaxConcurrency = req.MaxConcurrency
	}
	if req.IncidentResponse > 0 {
		sla.IncidentResponse = req.IncidentResponse
	}
	sla.UpdatedAt = time.Now()

	if result := db.DB.Save(&sla); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update SLA"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "SLA updated",
		"sla":     sla,
	})
}

type CreateLeaseRequest struct {
	BandwidthGB  float64 `json:"bandwidth_gb" binding:"required,min=1"`
	DurationDays int     `json:"duration_days" binding:"required,min=1,max=365"`
}

// createCircleLease creates a new lease for circle bandwidth
func createCircleLease(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}
	currentUserID, _ := c.Get("user_id")
	userID, _ := uuid.Parse(currentUserID.(string))

	var req CreateLeaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var circle models.Circle
	if result := db.DB.First(&circle, "id = ?", circleID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Circle not found"})
		return
	}

	if !circle.IsEnterprise {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Leasing requires enterprise tier"})
		return
	}

	// Check available bandwidth
	if circle.HasBandwidth() && circle.GetRemainingBandwidth() < req.BandwidthGB {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient bandwidth in pool"})
		return
	}

	// Calculate price
	totalPrice := req.BandwidthGB * circle.PricePerGB

	lease := models.CircleLease{
		ID:           uuid.New(),
		CircleID:     circleID,
		LesseeUserID: userID,
		Status:       "active",
		BandwidthGB:  req.BandwidthGB,
		PricePerGB:   circle.PricePerGB,
		TotalPrice:   totalPrice,
		StartsAt:     time.Now(),
		ExpiresAt:    time.Now().AddDate(0, 0, req.DurationDays),
		CreatedAt:    time.Now(),
	}

	if result := db.DB.Create(&lease); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create lease"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Lease created",
		"lease":   lease,
	})
}

// getCircleLeases returns all leases for a circle
func getCircleLeases(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}
	status := c.DefaultQuery("status", "")

	query := db.DB.Where("circle_id = ?", circleID)
	if status != "" {
		query = query.Where("status = ?", status)
	}

	var leases []models.CircleLease
	if result := query.Order("created_at DESC").Find(&leases); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch leases"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"leases": leases,
		"count":  len(leases),
	})
}
