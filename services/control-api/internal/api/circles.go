package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterCircleRoutes registers all circle-related API routes
func RegisterCircleRoutes(rg *gin.RouterGroup) {
	circles := rg.Group("/circles")
	{
		circles.POST("", createCircle)
		circles.GET("", listCircles)
		circles.GET("/my", getMyCircles)
		circles.GET("/:id", getCircle)
		circles.POST("/:id/join", joinCircle)
		circles.POST("/:id/invite", inviteToCircle)
		circles.DELETE("/:id/members/me", leaveCircle) // Using standard REST pattern for "leaving"
		circles.GET("/:id/members", getCircleMembers)
		circles.GET("/:id/stats", getCircleStats)
		circles.DELETE("/:id", deleteCircle)
		circles.PUT("/:id", updateCircle)
		circles.GET("/:id/feed", getCircleFeed)
		circles.POST("/:id/feed", postToCircleFeed)

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

	// Get user ID from middleware
	currentUserID, _ := c.Get("user_id")
	var userID uuid.UUID
	
	switch v := currentUserID.(type) {
	case string:
		userID, _ = uuid.Parse(v)
	case uuid.UUID:
		userID = v
	default:
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user identity type"})
		return
	}

	circle := models.NewCircle(req.Name, req.Description, userID, visibility)

	// Save to database
	if db.Social() != nil {
		if err := db.Social().Create(circle).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create circle"})
			return
		}

		// Add owner as member
		member := models.NewCircleMember(circle.ID, userID, "owner")
		if err := db.Social().Create(member).Error; err != nil {
			logging.Warn().
				Err(err).
				Str("circle_id", circle.ID.String()).
				Str("user_id", userID.String()).
				Msg("Failed to add owner as member")
		}
	}

	logging.Info().
		Str("circle_id", circle.ID.String()).
		Str("owner_id", userID.String()).
		Str("name", circle.Name).
		Str("visibility", circle.Visibility).
		Msg("Circle created successfully")

	c.JSON(http.StatusCreated, gin.H{
		"circle":  circle,
		"message": "Circle created successfully",
	})
}

// getMyCircles returns circles where the authenticated user is a member
func getMyCircles(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID, ok := currentUserID.(uuid.UUID)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user session"})
		return
	}

	// Find circle IDs where user is an active member
	var members []models.CircleMember
	if err := db.Social().Where("user_id = ? AND status = ?", userID, "active").Find(&members).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch memberships"})
		return
	}

	logging.Debug().
		Int("membership_count", len(members)).
		Str("user_id", userID.String()).
		Msg("Fetched memberships for user")

	circleIDs := make([]uuid.UUID, 0, len(members))
	for _, m := range members {
		circleIDs = append(circleIDs, m.CircleID)
	}

	var circles []models.Circle
	if len(circleIDs) > 0 {
		if err := db.Social().Where("id IN ?", circleIDs).Find(&circles).Error; err != nil {
			logging.Error(err).
				Interface("circle_ids", circleIDs).
				Msg("Failed to fetch circles for memberships")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch circles"})
			return
		}
	}

	logging.Debug().
		Int("circle_count", len(circles)).
		Msg("Returning user circles")

	c.JSON(http.StatusOK, gin.H{"circles": circles})
}

// listCircles returns all circles the user can access
func listCircles(c *gin.Context) {
	var circles []models.Circle

	if db.Social() != nil {
		// Get public circles and circles user is member of
		// For now, just get all public circles
		if err := db.Social().Where("visibility = ?", "public").Find(&circles).Error; err != nil {
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
	if err := db.Social().First(&circle, "id = ?", circleID).Error; err != nil {
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
	if err := db.Social().First(&circle, "id = ?", circleID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Circle not found"})
		return
	}

	// Check if already a member
	var existingMember models.CircleMember
	if err := db.Social().Where("circle_id = ? AND user_id = ?", circleID, userID).First(&existingMember).Error; err == nil {
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

	if err := db.Social().Create(member).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to join circle"})
		return
	}

	// Update member count
	db.Social().Model(&circle).Update("member_count", circle.MemberCount+1)

	logging.Info().
		Str("circle_id", circleID.String()).
		Str("user_id", userID.String()).
		Str("status", status).
		Msg("User joined circle")

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

	if err := db.Social().Create(invite).Error; err != nil {
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
	if err := db.Social().Where("circle_id = ? AND status = ?", circleID, "active").Preload("User").Find(&members).Error; err != nil {
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

	var circle models.Circle
	if err := db.Social().First(&circle, "id = ?", circleID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Circle not found"})
		return
	}

	// Aggregate lifetime stats from daily stats table
	var lifetime struct {
		TotalRevenue float64
		TotalBytes   int64
		AvgUptime    float64
	}
	db.Social().Model(&models.CircleDailyStats{}).
		Where("circle_id = ?", circleID).
		Select("COALESCE(SUM(total_revenue), 0) as total_revenue, COALESCE(SUM(total_bytes), 0) as total_bytes, COALESCE(AVG(uptime), 0) as avg_uptime").
		Scan(&lifetime)

	// Last 7 days bandwidth
	var last7Bytes int64
	db.Social().Model(&models.CircleDailyStats{}).
		Where("circle_id = ? AND date >= ?", circleID, time.Now().AddDate(0, 0, -7)).
		Select("COALESCE(SUM(total_bytes), 0)").
		Scan(&last7Bytes)

	// Last 30 days bandwidth
	var last30Bytes int64
	db.Social().Model(&models.CircleDailyStats{}).
		Where("circle_id = ? AND date >= ?", circleID, time.Now().AddDate(0, 0, -30)).
		Select("COALESCE(SUM(total_bytes), 0)").
		Scan(&last30Bytes)

	// Active nodes: healthy nodes owned by active circle members
	var activeNodes int64
	db.DB.Model(&models.Node{}).
		Where("provider_user_id IN (SELECT user_id FROM circle_members WHERE circle_id = ? AND status = 'active') AND is_healthy = ?", circleID, true).
		Count(&activeNodes)

	stats := models.CircleStats{
		CircleID:      circleID,
		Name:          circle.Name,
		MemberCount:   circle.MemberCount,
		TotalBytesGB:  float64(lifetime.TotalBytes) / (1024 * 1024 * 1024),
		TotalRevenue:  lifetime.TotalRevenue,
		AvgUptime:     lifetime.AvgUptime,
		ActiveNodes:   int(activeNodes),
		Last7DaysGB:   float64(last7Bytes) / (1024 * 1024 * 1024),
		Last30DaysGB:  float64(last30Bytes) / (1024 * 1024 * 1024),
		IsEnterprise:  circle.IsEnterprise,
		PriorityLevel: circle.PriorityLevel,
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
	if err := db.Social().First(&circle, "id = ?", circleID).Error; err != nil {
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

	if err := db.Social().Save(&circle).Error; err != nil {
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
	if err := db.Social().First(&circle, "id = ?", circleID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Circle not found"})
		return
	}

	if circle.OwnerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the owner can delete the circle"})
		return
	}

	// Delete logic - soft delete or hard delete?
	// Using hard delete for now to simplify cleanup
	if err := db.Social().Delete(&circle).Error; err != nil {
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
	if err := db.Social().First(&circle, "id = ?", circleID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Circle not found"})
		return
	}

	if circle.OwnerID == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Owner cannot leave the circle. Delete it or transfer ownership."})
		return
	}

	// db.Social().Where("circle_id = ? AND user_id = ?", circleID, userID).Delete(&models.CircleMember{})
	// Soft delete preferable
	var member models.CircleMember
	if err := db.Social().Where("circle_id = ? AND user_id = ?", circleID, userID).First(&member).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Member not found"})
		return
	}

	if err := db.Social().Delete(&member).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to leave circle"})
		return
	}

	// Decrement count
	db.Social().Model(&circle).Update("member_count", circle.MemberCount-1)

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
	if result := db.Social().First(&circle, "id = ?", circleID); result.Error != nil {
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

	if result := db.Social().Save(&circle); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upgrade circle"})
		return
	}

	// Create default SLA
	sla := models.NewCircleSLA(circleID)
	db.Social().Create(sla)

	logging.Info().
		Str("circle_id", circleID.String()).
		Str("owner_id", userID.String()).
		Float64("bandwidth_pool_gb", req.BandwidthPoolGB).
		Msg("Circle upgraded to enterprise")

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
	if result := db.Social().Where("circle_id = ?", circleID).First(&sla); result.Error != nil {
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
	if result := db.Social().First(&circle, "id = ?", circleID); result.Error != nil {
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
	if db.Social().Where("circle_id = ?", circleID).First(&sla).Error != nil {
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

	if result := db.Social().Save(&sla); result.Error != nil {
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
	if result := db.Social().First(&circle, "id = ?", circleID); result.Error != nil {
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

	if result := db.Social().Create(&lease); result.Error != nil {
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

	query := db.Social().Where("circle_id = ?", circleID)
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

// getCircleFeed returns posts from the circle's feed
func getCircleFeed(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}
	currentUserID, _ := c.Get("user_id")
	userID, _ := uuid.Parse(currentUserID.(string))

	// Verify membership
	var member models.CircleMember
	if err := db.Social().Where("circle_id = ? AND user_id = ? AND status = 'active'", circleID, userID).First(&member).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Must be a member to view feed"})
		return
	}

	page := 1 // Simplified pagination
	limit := 50
	offset := (page - 1) * limit

	var posts []models.CirclePost
	if err := db.Social().Where("circle_id = ?", circleID).
		Preload("Author").
		Order("pinned DESC, created_at DESC").
		Offset(offset).Limit(limit).
		Find(&posts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch feed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"posts": posts})
}

type CreateCirclePostRequest struct {
	Content string `json:"content" binding:"required"`
}

// postToCircleFeed creates a new post in the circle feed
func postToCircleFeed(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}
	currentUserID, _ := c.Get("user_id")
	userID, _ := uuid.Parse(currentUserID.(string))

	var req CreateCirclePostRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify membership
	var member models.CircleMember
	if err := db.Social().Where("circle_id = ? AND user_id = ? AND status = 'active'", circleID, userID).First(&member).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Must be a member to post"})
		return
	}

	post := models.CirclePost{
		ID:        uuid.New(),
		CircleID:  circleID,
		AuthorID:  userID,
		Content:   req.Content,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := db.Social().Create(&post).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create post"})
		return
	}

	// Reload to get author
	db.Social().Preload("Author").First(&post, "id = ?", post.ID)

	c.JSON(http.StatusCreated, gin.H{"post": post})
}
