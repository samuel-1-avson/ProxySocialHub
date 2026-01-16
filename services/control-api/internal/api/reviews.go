package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterReviewRoutes registers review-related routes
func RegisterReviewRoutes(rg *gin.RouterGroup) {
	rg.POST("/reviews", createReview)
	rg.GET("/users/:id/reviews", getUserReviews)
	rg.GET("/listings/:id/reviews", getListingReviews)
	rg.POST("/reviews/:id/respond", respondToReview)
	rg.POST("/reviews/:id/helpful", markReviewHelpful)
}

// createReview creates a new review for an order
func createReview(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	reviewerID := currentUserID.(uuid.UUID)

	var req models.CreateReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get order and verify ownership
	var order models.Order
	if err := db.DB.Preload("Listing").First(&order, "id = ?", req.OrderID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	if order.BuyerID != reviewerID {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can only review orders you made"})
		return
	}

	if order.Status != models.OrderStatusActive && order.Status != models.OrderStatusCompleted {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Can only review active or completed orders"})
		return
	}

	// Check if already reviewed
	var existingReview models.Review
	if err := db.DB.Where("order_id = ?", req.OrderID).First(&existingReview).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Order already reviewed"})
		return
	}

	review := models.Review{
		ReviewerID:        reviewerID,
		SellerID:          order.SellerID,
		ListingID:         &order.ListingID,
		OrderID:           &order.ID,
		Rating:            req.Rating,
		Title:             req.Title,
		Content:           req.Content,
		SpeedRating:       req.SpeedRating,
		ReliabilityRating: req.ReliabilityRating,
		SupportRating:     req.SupportRating,
		ValueRating:       req.ValueRating,
		VerifiedPurchase:  true,
	}

	tx := db.DB.Begin()

	if err := tx.Create(&review).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create review"})
		return
	}

	// Update seller stats
	var reviewCount int64
	var avgRating float64
	tx.Model(&models.Review{}).Where("seller_id = ?", order.SellerID).Count(&reviewCount)
	tx.Model(&models.Review{}).Where("seller_id = ?", order.SellerID).Select("AVG(rating)").Row().Scan(&avgRating)

	tx.Model(&models.User{}).Where("id = ?", order.SellerID).Updates(map[string]interface{}{
		"reviews_count": reviewCount,
		"avg_rating":    avgRating,
	})

	// Create feed event
	feedEvent := models.FeedEvent{
		ActorID:    &reviewerID,
		EventType:  models.FeedEventNewReview,
		TargetType: "review",
		TargetID:   &review.ID,
		Content:    review.Title,
	}
	tx.Create(&feedEvent)

	tx.Commit()

	db.DB.Preload("Reviewer").First(&review, "id = ?", review.ID)
	c.JSON(http.StatusCreated, review)
}

// getUserReviews returns reviews for a seller
func getUserReviews(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	var reviews []models.Review
	var total int64

	query := db.DB.Model(&models.Review{}).Where("seller_id = ?", userID)
	query.Count(&total)

	if err := query.Preload("Reviewer").Preload("Listing").
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&reviews).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch reviews"})
		return
	}

	// Calculate rating breakdown
	var ratingBreakdown struct {
		Avg   float64
		Count int64
	}
	db.DB.Model(&models.Review{}).Where("seller_id = ?", userID).
		Select("AVG(rating) as avg, COUNT(*) as count").
		Scan(&ratingBreakdown)

	c.JSON(http.StatusOK, gin.H{
		"reviews":    reviews,
		"total":      total,
		"page":       page,
		"limit":      limit,
		"avg_rating": ratingBreakdown.Avg,
	})
}

// getListingReviews returns reviews for a specific listing
func getListingReviews(c *gin.Context) {
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

	query := db.DB.Model(&models.Review{}).Where("listing_id = ?", listingID)
	query.Count(&total)

	if err := query.Preload("Reviewer").
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&reviews).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch reviews"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"reviews": reviews,
		"total":   total,
		"page":    page,
		"limit":   limit,
	})
}

// respondToReview allows seller to respond to a review
func respondToReview(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	reviewID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid review ID"})
		return
	}

	var req models.RespondToReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var review models.Review
	if err := db.DB.First(&review, "id = ?", reviewID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Review not found"})
		return
	}

	if review.SellerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the seller can respond to this review"})
		return
	}

	if review.SellerResponse != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Already responded to this review"})
		return
	}

	now := time.Now()
	db.DB.Model(&review).Updates(map[string]interface{}{
		"seller_response": req.Response,
		"response_at":     now,
	})

	db.DB.Preload("Reviewer").First(&review, "id = ?", reviewID)
	c.JSON(http.StatusOK, review)
}

// markReviewHelpful increments helpful count
func markReviewHelpful(c *gin.Context) {
	reviewID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid review ID"})
		return
	}

	var review models.Review
	if err := db.DB.First(&review, "id = ?", reviewID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Review not found"})
		return
	}

	db.DB.Model(&review).Update("helpful_count", review.HelpfulCount+1)
	c.JSON(http.StatusOK, gin.H{"helpful_count": review.HelpfulCount + 1})
}
