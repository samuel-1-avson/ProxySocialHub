package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/ws"
	"gorm.io/datatypes"
)

// RegisterUsageReviewRoutes registers usage-based review routes
func RegisterUsageReviewRoutes(rg *gin.RouterGroup) {
	// Review eligibility
	rg.GET("/sessions/:id/review-eligibility", getReviewEligibility)
	
	// Submit review
	rg.POST("/sessions/:id/review", submitSessionReview)
	
	// Get reviews with usage context
	rg.GET("/listings/:id/reviews-with-usage", getListingReviewsWithUsage)
	rg.GET("/providers/:id/reviews-with-usage", getProviderReviewsWithUsage)
	
	// Review prompts
	rg.POST("/reviews/prompt", triggerReviewPrompt)
}

// ReviewEligibilityResponse represents review eligibility for a session
type ReviewEligibilityResponse struct {
	SessionID        uuid.UUID `json:"session_id"`
	Eligible         bool      `json:"eligible"`
	Reason           string    `json:"reason,omitempty"`
	UsedGB           float64   `json:"used_gb"`
	DurationDays     int       `json:"duration_days"`
	PromptType       string    `json:"prompt_type,omitempty"` // "milestone", "session_end", "refill"
	CanReview        bool      `json:"can_review"`
	ExistingReviewID *uuid.UUID `json:"existing_review_id,omitempty"`
}

// getReviewEligibility checks if a session is eligible for review
func getReviewEligibility(c *gin.Context) {
	userID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid session ID"})
		return
	}

	var session models.Session
	if err := db.DB.Preload("Listing").Preload("Listing.Seller").First(&session, "id = ?", sessionID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
		return
	}

	// Verify ownership
	if session.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can only review your own sessions"})
		return
	}

	// Check for existing review
	var existingReview models.Review
	err = db.Social().Where("session_id = ?", sessionID).First(&existingReview).Error
	hasExistingReview := err == nil

	// Calculate usage metrics
	usedGB := float64(session.BytesUsed) / (1024 * 1024 * 1024)
	duration := time.Since(session.CreatedAt)
	durationDays := int(duration.Hours() / 24)

	// Determine eligibility
	eligibility := calculateEligibility(session, usedGB, durationDays, hasExistingReview)

	c.JSON(http.StatusOK, eligibility)
}

// calculateEligibility determines if and why a session is eligible for review
func calculateEligibility(session models.Session, usedGB float64, durationDays int, hasExistingReview bool) ReviewEligibilityResponse {
	response := ReviewEligibilityResponse{
		SessionID:    session.ID,
		UsedGB:       usedGB,
		DurationDays: durationDays,
		CanReview:    false,
	}

	// Already reviewed
	if hasExistingReview {
		response.Eligible = false
		response.Reason = "Already reviewed"
		return response
	}

	// Eligible triggers:
	// 1. Used 1GB+ (minimum meaningful usage)
	if usedGB >= 1 {
		response.Eligible = true
		response.CanReview = true
		
		if usedGB >= 100 {
			response.PromptType = "milestone"
			response.Reason = "You've used 100GB+ with this provider"
		} else if usedGB >= 10 {
			response.PromptType = "milestone"
			response.Reason = "You've used 10GB+ with this provider"
		} else {
			response.PromptType = "milestone"
			response.Reason = "You've used 1GB+ with this provider"
		}
		return response
	}

	// 2. Session ended with some usage
	if session.Status != models.SessionActive && usedGB > 0 {
		response.Eligible = true
		response.CanReview = true
		response.PromptType = "session_end"
		response.Reason = fmt.Sprintf("Session ended with %.1fGB used", usedGB)
		return response
	}

	// 3. Used for more than 7 days (even if low GB - might be light usage)
	if durationDays >= 7 && usedGB > 0 {
		response.Eligible = true
		response.CanReview = true
		response.PromptType = "duration"
		response.Reason = fmt.Sprintf("Used for %d days", durationDays)
		return response
	}

	// Not eligible yet
	response.Eligible = false
	response.Reason = fmt.Sprintf("Use at least 1GB before reviewing (currently %.1fGB)", usedGB)
	return response
}

// SessionReviewRequest represents a review submission for a session
type SessionReviewRequest struct {
	Rating            int     `json:"rating" binding:"required,min=1,max=5"`
	SpeedRating       int     `json:"speed_rating" binding:"min=0,max=5"`
	ReliabilityRating int     `json:"reliability_rating" binding:"min=0,max=5"`
	SupportRating     int     `json:"support_rating" binding:"min=0,max=5"`
	ValueRating       int     `json:"value_rating" binding:"min=0,max:5"`
	Title             string  `json:"title" binding:"required,min=5,max:200"`
	Content           string  `json:"content" binding:"required,min=20,max:2000"`
	WouldRecommend    bool    `json:"would_recommend"`
}

// submitSessionReview submits a review for a session
func submitSessionReview(c *gin.Context) {
	userID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid session ID"})
		return
	}

	var session models.Session
	if err := db.DB.Preload("Listing").Preload("Listing.Seller").First(&session, "id = ?", sessionID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
		return
	}

	// Verify ownership
	if session.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can only review your own sessions"})
		return
	}

	// Check not already reviewed
	var existingReview models.Review
	if err := db.Social().Where("session_id = ?", sessionID).First(&existingReview).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Session already reviewed"})
		return
	}

	var req SessionReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Calculate usage metrics for context
	usedGB := float64(session.BytesUsed) / (1024 * 1024 * 1024)
	durationDays := int(time.Since(session.CreatedAt).Hours() / 24)

	// Create usage context JSON
	usageContext := map[string]interface{}{
		"used_gb":       usedGB,
		"duration_days": durationDays,
		"session_type":  session.Type,
	}
	usageJSON, _ := json.Marshal(usageContext)
	
	// Create review with session context
	review := models.Review{
		ReviewerID:       userID,
		SellerID:         session.Listing.SellerID,
		ListingID:        session.ListingID,
		SessionID:        &sessionID,
		Rating:           req.Rating,
		Title:            req.Title,
		Content:          req.Content,
		VerifiedPurchase: true,
		UsageContext:     datatypes.JSON(usageJSON),
	}
	
	// Set optional sub-ratings if provided (non-zero)
	if req.SpeedRating > 0 {
		review.SpeedRating = &req.SpeedRating
	}
	if req.ReliabilityRating > 0 {
		review.ReliabilityRating = &req.ReliabilityRating
	}
	if req.SupportRating > 0 {
		review.SupportRating = &req.SupportRating
	}
	if req.ValueRating > 0 {
		review.ValueRating = &req.ValueRating
	}

	// Mark session as reviewed
	session.ReviewPrompted = true
	session.ReviewPromptedAt = &[]time.Time{time.Now()}[0]

	tx := db.DB.Begin()

	if err := tx.Create(&review).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create review"})
		return
	}

	if err := tx.Save(&session).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update session"})
		return
	}

	// Update provider stats
	var reviewCount int64
	var avgRating float64
	tx.Model(&models.Review{}).Where("seller_id = ?", session.Listing.SellerID).Count(&reviewCount)
	tx.Model(&models.Review{}).Where("seller_id = ?", session.Listing.SellerID).Select("AVG(rating)").Scan(&avgRating)

	tx.Model(&models.User{}).Where("id = ?", session.Listing.SellerID).Updates(map[string]interface{}{
		"reviews_count": reviewCount,
		"avg_rating":    avgRating,
	})

	tx.Commit()

	// Notify provider
	ws.BroadcastToUser(session.Listing.SellerID.String(), ws.MsgTypeNewReview, gin.H{
		"review_id":      review.ID,
		"rating":         req.Rating,
		"buyer_id":       userID,
		"listing_id":     session.ListingID,
		"session_id":     sessionID,
		"used_gb":        usedGB,
		"duration_days":  durationDays,
	})

	// Create feed event if high rating
	if req.Rating >= 4 {
		username := "someone"
		if session.Listing.Seller.Username != nil {
			username = *session.Listing.Seller.Username
		}
		
		event := models.CreateFeedEvent(
			&userID,
			models.FeedEventNewReview,
			"review",
			&review.ID,
			fmt.Sprintf("rated %s %.1f stars after using %.0fGB", username, float64(req.Rating), usedGB),
			map[string]interface{}{
				"rating":      req.Rating,
				"used_gb":     usedGB,
				"listing_id":  session.ListingID,
				"provider_id": session.Listing.SellerID,
			},
		)
		db.Social().Create(event)
	}

	// Check for badge (5-star streak, trusted provider, etc.)
	go CheckAndAwardBadges(session.Listing.SellerID, "review")

	c.JSON(http.StatusCreated, gin.H{
		"review":         review,
		"usage_context": map[string]interface{}{
			"used_gb":       usedGB,
			"duration_days": durationDays,
		},
	})
}

// ReviewWithUsage represents a review with usage context
type ReviewWithUsage struct {
	models.Review
	UsedGB       float64 `json:"used_gb"`
	DurationDays int     `json:"duration_days"`
}

// getListingReviewsWithUsage returns reviews with usage context
func getListingReviewsWithUsage(c *gin.Context) {
	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	var reviews []models.Review
	var total int64

	query := db.Social().Model(&models.Review{}).Where("listing_id = ?", listingID)
	query.Count(&total)

	if err := query.
		Preload("Reviewer").
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&reviews).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch reviews"})
		return
	}

	// Enrich with usage context
	reviewsWithUsage := make([]ReviewWithUsage, len(reviews))
	for i, review := range reviews {
		usedGB := 0.0
		durationDays := 0

		if review.SessionID != nil {
			var session models.Session
			if err := db.DB.Select("bytes_used", "created_at").First(&session, "id = ?", *review.SessionID).Error; err == nil {
				usedGB = float64(session.BytesUsed) / (1024 * 1024 * 1024)
				durationDays = int(time.Since(session.CreatedAt).Hours() / 24)
			}
		}

		// Check if usage context exists in JSON
		if review.UsageContext != nil {
			var ctx map[string]interface{}
			if err := json.Unmarshal(review.UsageContext, &ctx); err == nil {
				if u, ok := ctx["used_gb"].(float64); ok {
					usedGB = u
				}
				if d, ok := ctx["duration_days"].(float64); ok {
					durationDays = int(d)
				}
			}
		}

		reviewsWithUsage[i] = ReviewWithUsage{
			Review:       review,
			UsedGB:       usedGB,
			DurationDays: durationDays,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"reviews":      reviewsWithUsage,
		"total":        total,
		"page":         page,
		"limit":        limit,
		"avg_rating":   calculateAvgRating(reviews),
	})
}

// getProviderReviewsWithUsage returns provider reviews with usage context
func getProviderReviewsWithUsage(c *gin.Context) {
	providerID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid provider ID"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	var reviews []models.Review
	var total int64

	query := db.Social().Model(&models.Review{}).Where("seller_id = ?", providerID)
	query.Count(&total)

	if err := query.
		Preload("Reviewer").
		Preload("Listing").
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&reviews).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch reviews"})
		return
	}

	// Enrich with usage context
	reviewsWithUsage := make([]ReviewWithUsage, len(reviews))
	for i, review := range reviews {
		usedGB := 0.0
		durationDays := 0

		if review.SessionID != nil {
			var session models.Session
			if err := db.DB.Select("bytes_used", "created_at").First(&session, "id = ?", *review.SessionID).Error; err == nil {
				usedGB = float64(session.BytesUsed) / (1024 * 1024 * 1024)
				durationDays = int(time.Since(session.CreatedAt).Hours() / 24)
			}
		}

		reviewsWithUsage[i] = ReviewWithUsage{
			Review:       review,
			UsedGB:       usedGB,
			DurationDays: durationDays,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"reviews":    reviewsWithUsage,
		"total":      total,
		"page":       page,
		"limit":      limit,
	})
}

// triggerReviewPrompt manually triggers a review prompt (admin/debug)
func triggerReviewPrompt(c *gin.Context) {
	// This endpoint can be used by admins to manually trigger review prompts
	// or by the system to batch process review prompts
	
	var req struct {
		SessionID uuid.UUID `json:"session_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var session models.Session
	if err := db.DB.Preload("Listing").Preload("User").First(&session, "id = ?", req.SessionID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
		return
	}

	usedGB := float64(session.BytesUsed) / (1024 * 1024 * 1024)

	// Send review prompt
	ws.BroadcastToUser(session.UserID.String(), "review_prompt", gin.H{
		"session_id":    session.ID,
		"listing_id":    session.ListingID,
		"provider_id":   session.Listing.SellerID,
		"provider_name": session.Listing.Seller.Username,
		"used_gb":       usedGB,
		"message":       fmt.Sprintf("You've used %.1fGB! How was your experience?", usedGB),
	})

	c.JSON(http.StatusOK, gin.H{"message": "Review prompt triggered"})
}

// calculateAvgRating calculates average rating from reviews
func calculateAvgRating(reviews []models.Review) float64 {
	if len(reviews) == 0 {
		return 0
	}

	var sum int
	for _, r := range reviews {
		sum += r.Rating
	}

	return float64(sum) / float64(len(reviews))
}
