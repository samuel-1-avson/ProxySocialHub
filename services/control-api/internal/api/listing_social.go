package api

import (
	"errors"
	"fmt"
	"gorm.io/gorm"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterListingSocialRoutes registers social integration routes for listings
func RegisterListingSocialRoutes(rg *gin.RouterGroup) {
	// Social context for listings
	rg.GET("/listings/:id/social", getListingSocialContext)
	rg.POST("/listings/:id/inquire", createListingInquiry)
	rg.GET("/listings/:id/qa", getListingQA)
	rg.POST("/listings/:id/qa", askListingQuestion)

	// Online presence
	rg.POST("/presence/heartbeat", updatePresence)
	rg.GET("/users/:id/presence", getUserPresence)
}

// RegisterProviderRelationshipRoutes registers provider-scoped relationship management routes.
func RegisterProviderRelationshipRoutes(rg *gin.RouterGroup) {
	rg.GET("/provider/relationships", getProviderRelationships)
	rg.GET("/provider/relationships/stats", getProviderRelationshipStats)
	rg.GET("/provider/relationships/:buyerId", getProviderRelationshipDetail)
	rg.POST("/provider/relationships/:buyerId/offer", sendRefillOffer)
}

// RegisterBuyerRelationshipRoutes registers buyer-scoped relationship read routes.
func RegisterBuyerRelationshipRoutes(rg *gin.RouterGroup) {
	rg.GET("/buyer/relationships", getBuyerRelationships)
	rg.GET("/buyer/relationships/:providerId", getBuyerRelationshipDetail)
}

// ListingSocialContext represents social data for a listing
type ListingSocialContext struct {
	ListingID           uuid.UUID          `json:"listing_id"`
	ActiveSessionsCount int                `json:"active_sessions_count"`
	TotalSessionsCount  int                `json:"total_sessions_count"`
	AllowDirectMessage  bool               `json:"allow_direct_message"`
	Provider            ProviderSocialInfo `json:"provider"`
	IsFollowed          bool               `json:"is_followed"`
	HasExistingSession  bool               `json:"has_existing_session"`
	ExistingSessionID   *uuid.UUID         `json:"existing_session_id,omitempty"`
}

// ProviderSocialInfo represents public social info about a provider
type ProviderSocialInfo struct {
	ID              uuid.UUID  `json:"id"`
	Username        string     `json:"username"`
	DisplayName     string     `json:"display_name"`
	AvatarURL       string     `json:"avatar_url"`
	IsOnline        bool       `json:"is_online"`
	LastSeenAt      *time.Time `json:"last_seen_at,omitempty"`
	AvgRating       float64    `json:"avg_rating"`
	ReviewsCount    int        `json:"reviews_count"`
	TotalBandwidth  float64    `json:"total_bandwidth_sold"`
	ResponseTimeMin int        `json:"response_time_min"`
}

// getListingSocialContext returns social context for a listing
func getListingSocialContext(c *gin.Context) {
	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	var listing models.ProxyListing
	if err := db.DB.Preload("Seller").First(&listing, "id = ?", listingID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
		return
	}

	// Get current user ID if authenticated
	var currentUserID uuid.UUID
	var isAuthenticated bool
	if uid, ok := c.Get("user_id"); ok {
		if id, ok := uid.(uuid.UUID); ok {
			currentUserID = id
			isAuthenticated = true
		}
	} else if uidStr := c.GetString("userID"); uidStr != "" {
		currentUserID, _ = uuid.Parse(uidStr)
		if currentUserID != uuid.Nil {
			isAuthenticated = true
		}
	}

	// Count active sessions for this listing
	var activeSessionsCount int64
	db.DB.Model(&models.Session{}).
		Where("listing_id = ? AND status = ? AND (expires_at IS NULL OR expires_at > ?)",
			listingID, models.SessionActive, time.Now()).
		Count(&activeSessionsCount)

	// Count total sessions
	var totalSessionsCount int64
	db.DB.Model(&models.Session{}).
		Where("listing_id = ?", listingID).
		Count(&totalSessionsCount)

	// Check if user follows provider
	isFollowed := false
	if isAuthenticated {
		var followCount int64
		db.Social().Model(&models.Follow{}).
			Where("follower_id = ? AND following_id = ?", currentUserID, listing.SellerID).
			Count(&followCount)
		isFollowed = followCount > 0
	}

	// Check for existing session between buyer and this listing's provider
	hasExistingSession := false
	var existingSessionID *uuid.UUID
	if isAuthenticated {
		var session models.Session
		if err := db.DB.Where("user_id = ? AND listing_id = ? AND status = ?",
			currentUserID, listingID, models.SessionActive).
			First(&session).Error; err == nil {
			hasExistingSession = true
			existingSessionID = &session.ID
		}
	}

	// Build provider social info
	publicProvider := listing.Seller.ToPublicProfile()
	providerInfo := ProviderSocialInfo{
		ID:              listing.Seller.ID,
		Username:        safeString(listing.Seller.Username),
		DisplayName:     safeString(publicProvider.DisplayName),
		AvatarURL:       safeString(publicProvider.AvatarURL),
		IsOnline:        publicProvider.IsOnline,
		LastSeenAt:      publicProvider.LastSeenAt,
		AvgRating:       listing.Seller.AvgRating,
		ReviewsCount:    listing.Seller.ReviewsCount,
		TotalBandwidth:  listing.Seller.TotalBandwidthSold,
		ResponseTimeMin: estimateResponseTime(listing.Seller.ID),
	}

	context := ListingSocialContext{
		ListingID:           listingID,
		ActiveSessionsCount: 0,
		TotalSessionsCount:  0,
		AllowDirectMessage:  listing.AllowDirectMessage,
		Provider:            providerInfo,
		IsFollowed:          isFollowed,
		HasExistingSession:  hasExistingSession,
		ExistingSessionID:   existingSessionID,
	}

	c.JSON(http.StatusOK, context)
}

// ListingInquiryRequest represents a request to inquire about a listing
type ListingInquiryRequest struct {
	Message     string  `json:"message" binding:"required,min=1,max=1000"`
	Intent      string  `json:"intent"` // "web_scraping", "vpn", "gaming", etc.
	ClientMsgID string  `json:"client_msg_id" binding:"max=128"`
	ExpectedGB  float64 `json:"expected_gb"` // Expected monthly usage
}

// createListingInquiry creates a conversation from a listing inquiry
func createListingInquiry(c *gin.Context) {
	buyerID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	var listing models.ProxyListing
	if err := db.DB.First(&listing, "id = ?", listingID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
		return
	}

	// Check if direct messaging is allowed
	if !listing.AllowDirectMessage {
		c.JSON(http.StatusForbidden, gin.H{"error": "Provider is not accepting direct messages"})
		return
	}

	var req ListingInquiryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	providerID := listing.SellerID
	if rejectContact(c, buyerID, providerID, &listingID, nil) {
		return
	}

	// Get or create conversation
	conversation, err := getOrCreateConversation(buyerID, providerID, &listingID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create conversation"})
		return
	}

	// Enrich message with context
	enrichedMessage := req.Message
	if req.Intent != "" {
		enrichedMessage += "\n\n[Intent: " + req.Intent + "]"
	}
	if req.ExpectedGB > 0 {
		enrichedMessage += "\n[Expected usage: " + formatGB(req.ExpectedGB) + "]"
	}

	key, valid := resolveClientMsgID(c, req.ClientMsgID)
	if !valid {
		c.JSON(400, gin.H{"error": "Invalid message key"})
		return
	}
	message, created, err := createMessageChecked(conversation.ID, buyerID, enrichedMessage, nil, key, "listing_inquiry")
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to send inquiry"})
		return
	}
	if created {
		deliverNewMessage(c, *conversation, message, buyerID)
	}

	c.JSON(http.StatusCreated, gin.H{
		"conversation_id": conversation.ID,
		"message":         messageDTOFrom(message),
		"provider":        providerID,
	})
}

// getOrCreateConversation gets existing or creates new conversation between users
func getOrCreateConversation(user1ID, user2ID uuid.UUID, listingID *uuid.UUID) (*models.Conversation, error) {
	var conversation models.Conversation

	// Look for existing conversation
	err := db.Social().
		Where("(participant1 = ? AND participant2 = ?) OR (participant1 = ? AND participant2 = ?)",
			user1ID, user2ID, user2ID, user1ID).
		First(&conversation).Error

	if err == nil {
		return &conversation, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	// Create new conversation
	conversation = models.Conversation{
		Participant1: user1ID,
		Participant2: user2ID,
		ListingID:    listingID,
	}

	if err := db.Social().Create(&conversation).Error; err != nil {
		return nil, err
	}

	return &conversation, nil
}

// getListingQA returns Q&A for a listing
func getListingQA(c *gin.Context) {
	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	// Get threads linked to this listing
	var threads []models.ForumThread
	db.Social().
		Preload("Author").
		Where("listing_id = ?", listingID).
		Order("created_at DESC").
		Find(&threads)

	c.JSON(http.StatusOK, gin.H{
		"questions": forumThreadDTOs(threads),
		"count":     len(threads),
	})
}

// askListingQuestion asks a question about a listing (stored as a forum thread with listing_id).
func askListingQuestion(c *gin.Context) {
	userID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	var req struct {
		Title   string `json:"title" binding:"required,min=5,max=200"`
		Content string `json:"content" binding:"required,min=10,max=2000"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	category, err := resolveForumCategorySlug("marketplace")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Forum category unavailable"})
		return
	}

	listingIDCopy := listingID
	slug := fmt.Sprintf("listing-%s-%s", listingID.String()[:8], slugify(req.Title))
	if len(slug) > 255 {
		slug = slug[:255]
	}

	thread := models.ForumThread{
		CategoryID: category.ID,
		AuthorID:   userID,
		Title:      req.Title,
		Slug:       slug,
		Content:    req.Content,
		ListingID:  &listingIDCopy,
	}

	if err := db.Social().Create(&thread).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to post question"})
		return
	}

	db.Social().Preload("Author").Preload("Category").First(&thread, "id = ?", thread.ID)

	c.JSON(http.StatusCreated, thread)
}

// resolveForumCategorySlug returns a forum category by slug, seeding marketplace if needed.
func resolveForumCategorySlug(slug string) (models.ForumCategory, error) {
	var category models.ForumCategory
	if err := db.Social().Where("slug = ?", slug).First(&category).Error; err == nil {
		return category, nil
	}

	if slug == "marketplace" {
		seed := models.ForumCategory{
			Name:        "Buying & Selling",
			Slug:        "marketplace",
			Description: "Discuss proxy purchases, deals, and recommendations",
			SortOrder:   5,
		}
		if err := db.Social().Create(&seed).Error; err == nil {
			return seed, nil
		}
	}

	err := db.Social().Where("slug = ?", slug).First(&category).Error
	return category, err
}

// getProviderRelationships returns all buyer relationships for a provider
func getProviderRelationships(c *gin.Context) {
	providerID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	status := c.DefaultQuery("status", "active")

	var relationships []models.ProviderBuyerRelationship
	query := db.Social().
		Preload("Buyer").
		Where("provider_id = ?", providerID)

	if status != "all" {
		query = query.Where("status = ?", status)
	}

	if err := query.Order("last_session_at DESC NULLS LAST").Find(&relationships).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch relationships"})
		return
	}

	resp := make([]RelationshipResponse, len(relationships))
	for i, r := range relationships {
		resp[i] = mapRelationship(r)
	}

	c.JSON(http.StatusOK, gin.H{
		"relationships": resp,
		"count":         len(resp),
	})
}

// getProviderRelationshipDetail returns detailed relationship info
func getProviderRelationshipDetail(c *gin.Context) {
	providerID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	buyerID, err := uuid.Parse(c.Param("buyerId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid buyer ID"})
		return
	}

	var relationship models.ProviderBuyerRelationship
	if err := db.Social().
		Preload("Buyer").
		Where("provider_id = ? AND buyer_id = ?", providerID, buyerID).
		First(&relationship).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Relationship not found"})
		return
	}

	// Get recent sessions
	var sessions []models.Session
	db.DB.
		Where("user_id = ? AND listing_id IN (SELECT id FROM proxy_listings WHERE seller_id = ?)",
			buyerID, providerID).
		Order("created_at DESC").
		Limit(10).
		Find(&sessions)

	var conversation models.Conversation
	db.Social().
		Where("(participant1 = ? AND participant2 = ?) OR (participant1 = ? AND participant2 = ?)",
			providerID, buyerID, buyerID, providerID).
		First(&conversation)

	c.JSON(http.StatusOK, gin.H{
		"relationship":    mapRelationship(relationship),
		"sessions":        sessions,
		"conversation_id": conversation.ID,
	})
}

// getBuyerRelationships returns provider relationships for the current buyer.
func getBuyerRelationships(c *gin.Context) {
	buyerID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	status := c.DefaultQuery("status", "active")

	var relationships []models.ProviderBuyerRelationship
	query := db.Social().
		Preload("Provider").
		Where("buyer_id = ?", buyerID)

	if status != "all" {
		query = query.Where("status = ?", status)
	}

	if err := query.Order("last_session_at DESC NULLS LAST").Find(&relationships).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch relationships"})
		return
	}

	resp := make([]BuyerRelationshipResponse, len(relationships))
	for i, r := range relationships {
		resp[i] = mapBuyerRelationship(r)
	}

	c.JSON(http.StatusOK, gin.H{
		"relationships": resp,
		"count":         len(resp),
	})
}

// getBuyerRelationshipDetail returns relationship info for a buyer with a specific provider.
func getBuyerRelationshipDetail(c *gin.Context) {
	buyerID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	providerID, err := uuid.Parse(c.Param("providerId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid provider ID"})
		return
	}

	var relationship models.ProviderBuyerRelationship
	if err := db.Social().
		Preload("Provider").
		Where("provider_id = ? AND buyer_id = ?", providerID, buyerID).
		First(&relationship).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Relationship not found"})
		return
	}

	var sessions []models.Session
	db.DB.
		Where("user_id = ? AND listing_id IN (SELECT id FROM proxy_listings WHERE seller_id = ?)",
			buyerID, providerID).
		Order("created_at DESC").
		Limit(10).
		Find(&sessions)

	var conversation models.Conversation
	db.Social().
		Where("(participant1 = ? AND participant2 = ?) OR (participant1 = ? AND participant2 = ?)",
			providerID, buyerID, buyerID, providerID).
		First(&conversation)

	c.JSON(http.StatusOK, gin.H{
		"relationship":    mapBuyerRelationship(relationship),
		"sessions":        sessions,
		"conversation_id": conversation.ID,
	})
}

// RefillOfferRequest represents an offer to refill
type RefillOfferRequest struct {
	BonusGB         float64 `json:"bonus_gb"`         // Extra GB offered
	DiscountPercent float64 `json:"discount_percent"` // % off regular price
	Message         string  `json:"message" binding:"max=1000"`
	ClientMsgID     string  `json:"client_msg_id" binding:"max=128"` // Custom message
}

// sendRefillOffer sends a refill offer to a buyer
func sendRefillOffer(c *gin.Context) {
	providerID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	buyerID, err := uuid.Parse(c.Param("buyerId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid buyer ID"})
		return
	}

	var req RefillOfferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if rejectContact(c, providerID, buyerID, nil, nil) {
		return
	}
	// Get or create conversation
	conversation, err := getOrCreateConversation(providerID, buyerID, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create conversation"})
		return
	}

	// Create offer message
	offerMessage := "🎉 Special Refill Offer!\n\n"
	if req.BonusGB > 0 {
		offerMessage += "🎁 Bonus: " + formatGB(req.BonusGB) + " extra\n"
	}
	if req.DiscountPercent > 0 {
		offerMessage += "💰 Discount: " + formatPercent(req.DiscountPercent) + " off\n"
	}
	if req.Message != "" {
		offerMessage += "\n" + req.Message
	}

	key, valid := resolveClientMsgID(c, req.ClientMsgID)
	if !valid {
		c.JSON(400, gin.H{"error": "Invalid message key"})
		return
	}
	message, created, err := createMessageChecked(conversation.ID, providerID, offerMessage, nil, key, "refill_offer")
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to send offer"})
		return
	}
	if created {
		deliverNewMessage(c, *conversation, message, providerID)
	}

	c.JSON(http.StatusOK, gin.H{
		"message":         "Offer sent",
		"conversation_id": conversation.ID,
	})
}

// updatePresence updates user's online status
func updatePresence(c *gin.Context) {
	userID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	// Update online status
	now := time.Now()
	db.DB.Model(&models.User{}).Where("id = ?", userID).Updates(map[string]interface{}{
		"is_online":    true,
		"last_seen_at": now,
	})

	c.JSON(http.StatusOK, gin.H{"status": "online", "timestamp": now})
}

// getUserPresence returns user's online status
func getUserPresence(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "Invalid user ID"})
		return
	}
	var u models.User
	if db.DB.First(&u, "id = ?", userID).Error != nil {
		c.JSON(404, gin.H{"error": "User not found"})
		return
	}
	viewer, has := GetUserID(c)
	visible := u.PresenceVisible
	if has && viewer != userID {
		if blocked, err := blockedBetween(viewer, userID); err != nil || blocked {
			visible = false
		}
	}
	if has && viewer == userID {
		visible = true
	}
	var seen *time.Time
	online := false
	if visible && u.LastSeenAt != nil && time.Since(*u.LastSeenAt) < 2*time.Minute {
		rounded := u.LastSeenAt.Truncate(5 * time.Minute)
		seen = &rounded
		online = u.IsOnline && time.Since(*u.LastSeenAt) < 2*time.Minute
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"user_id": userID, "is_online": online, "last_seen_at": seen})
}

// Helper functions

func getCurrentUserID(c *gin.Context) (uuid.UUID, error) {
	if uid, ok := c.Get("user_id"); ok {
		if id, ok := uid.(uuid.UUID); ok {
			return id, nil
		}
	}
	if uidStr := c.GetString("userID"); uidStr != "" {
		return uuid.Parse(uidStr)
	}
	return uuid.Nil, fmt.Errorf("no user ID found")
}

func safeString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func formatGB(gb float64) string {
	if gb >= 1000 {
		return fmt.Sprintf("%.1fTB", gb/1000)
	}
	return fmt.Sprintf("%.0fGB", gb)
}

func formatPercent(p float64) string {
	return fmt.Sprintf("%.0f%%", p)
}

// truncate shortens s to maxLen characters (runes, so an emoji or accented
// letter is never cut in half), ending with "..." when cut.
func truncate(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return string(runes[:maxLen])
	}
	return string(runes[:maxLen-3]) + "..."
}

// estimateResponseTime returns the provider's average first-reply time in
// minutes calculated from the messages table over the last 30 days.
// It looks for conversations where the provider is Participant2 (seller),
// and computes the average gap between the first buyer message and the
// provider's first reply in the same conversation.
// Falls back to 15 minutes when there is insufficient data.
func estimateResponseTime(providerID uuid.UUID) int {
	// Raw SQL: for each conversation involving this provider, find the first
	// buyer message and the first subsequent provider reply, then average the gap.
	type avgResult struct {
		AvgMinutes float64
	}
	var result avgResult

	// conversations where the provider is a participant
	err := db.Social().Raw(`
		SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (provider_reply.created_at - buyer_msg.created_at)) / 60), 0) AS avg_minutes
		FROM conversations c
		JOIN LATERAL (
			SELECT m.created_at
			FROM messages m
			WHERE m.conversation_id = c.id
			  AND m.sender_id != ?
			  AND m.is_deleted = false
			ORDER BY m.created_at ASC
			LIMIT 1
		) buyer_msg ON true
		JOIN LATERAL (
			SELECT m.created_at
			FROM messages m
			WHERE m.conversation_id = c.id
			  AND m.sender_id = ?
			  AND m.created_at > buyer_msg.created_at
			  AND m.is_deleted = false
			ORDER BY m.created_at ASC
			LIMIT 1
		) provider_reply ON true
		WHERE (c.participant1 = ? OR c.participant2 = ?)
		  AND c.created_at >= NOW() - INTERVAL '30 days'
	`, providerID, providerID, providerID, providerID).Scan(&result).Error

	if err != nil || result.AvgMinutes <= 0 {
		return 15 // fallback
	}
	avg := int(result.AvgMinutes)
	if avg < 1 {
		return 1
	}
	return avg
}

// trackInquiry records an inquiry event as a feed entry so conversion metrics
// (inquiries → orders) can be measured in the analytics pipeline.
func trackInquiry(listingID, buyerID, providerID uuid.UUID, intent string, expectedGB float64) {
	meta := map[string]interface{}{
		"intent":      intent,
		"expected_gb": expectedGB,
	}
	event := models.CreateFeedEvent(
		&buyerID,
		models.FeedEventType("listing_inquiry"),
		"listing",
		&listingID,
		"sent an inquiry",
		meta,
	)
	db.Social().Create(event)
}

// RelationshipStats represents statistics about provider relationships
type RelationshipStats struct {
	TotalRelationships    int                    `json:"total_relationships"`
	TotalBandwidthSoldGB  float64                `json:"total_bandwidth_sold_gb"`
	TotalRevenue          float64                `json:"total_revenue"`
	AvgSessionsPerBuyer   float64                `json:"avg_sessions_per_buyer"`
	TopBuyers             []RelationshipResponse `json:"top_buyers"`
	RecentFirstTimeBuyers []RelationshipResponse `json:"recent_first_time_buyers"`
}

// RelationshipResponse is a flattened version of ProviderBuyerRelationship for the frontend
type RelationshipResponse struct {
	BuyerID          uuid.UUID  `json:"buyer_id"`
	BuyerName        string     `json:"buyer_name"`
	BuyerUsername    string     `json:"buyer_username"`
	BuyerAvatar      string     `json:"buyer_avatar"`
	BuyerEmail       string     `json:"buyer_email"`
	FirstSessionAt   time.Time  `json:"first_session_at"`
	LastSessionAt    *time.Time `json:"last_session_at,omitempty"`
	SessionCount     int        `json:"session_count"`
	TotalBandwidthGB float64    `json:"total_bandwidth_gb"`
	TotalSpent       float64    `json:"total_spent"`
	Status           string     `json:"status"`
}

// BuyerRelationshipResponse is the buyer-facing view of a provider relationship.
type BuyerRelationshipResponse struct {
	ProviderID       uuid.UUID  `json:"provider_id"`
	ProviderName     string     `json:"provider_name"`
	ProviderUsername string     `json:"provider_username"`
	ProviderAvatar   string     `json:"provider_avatar"`
	BuyerID          uuid.UUID  `json:"buyer_id"`
	FirstSessionAt   time.Time  `json:"first_session_at"`
	LastSessionAt    *time.Time `json:"last_session_at,omitempty"`
	SessionCount     int        `json:"session_count"`
	TotalBandwidthGB float64    `json:"total_bandwidth_gb"`
	TotalSpent       float64    `json:"total_spent"`
	Status           string     `json:"status"`
}

func mapRelationship(r models.ProviderBuyerRelationship) RelationshipResponse {
	resp := RelationshipResponse{
		BuyerID:          r.BuyerID,
		FirstSessionAt:   r.FirstSessionAt,
		LastSessionAt:    r.LastSessionAt,
		SessionCount:     r.TotalSessions,
		TotalBandwidthGB: r.TotalBandwidthGB,
		TotalSpent:       r.TotalSpent,
		Status:           r.Status,
	}

	if r.Buyer != nil {
		public := r.Buyer.ToPublicProfile()
		if public.DisplayName != nil {
			resp.BuyerName = *public.DisplayName
		} else if r.Buyer.Username != nil {
			resp.BuyerName = *r.Buyer.Username
		} else {
			resp.BuyerName = "User"
		}

		if r.Buyer.Username != nil {
			resp.BuyerUsername = *r.Buyer.Username
		}
		if public.AvatarURL != nil {
			resp.BuyerAvatar = *public.AvatarURL
		}
	}

	return resp
}

func mapBuyerRelationship(r models.ProviderBuyerRelationship) BuyerRelationshipResponse {
	resp := BuyerRelationshipResponse{
		ProviderID:       r.ProviderID,
		BuyerID:          r.BuyerID,
		FirstSessionAt:   r.FirstSessionAt,
		LastSessionAt:    r.LastSessionAt,
		SessionCount:     r.TotalSessions,
		TotalBandwidthGB: r.TotalBandwidthGB,
		TotalSpent:       r.TotalSpent,
		Status:           r.Status,
	}

	if r.Provider != nil {
		public := r.Provider.ToPublicProfile()
		if public.DisplayName != nil {
			resp.ProviderName = *public.DisplayName
		} else if r.Provider.Username != nil {
			resp.ProviderName = *r.Provider.Username
		} else {
			resp.ProviderName = "Provider"
		}
		if r.Provider.Username != nil {
			resp.ProviderUsername = *r.Provider.Username
		}
		if public.AvatarURL != nil {
			resp.ProviderAvatar = *public.AvatarURL
		}
	}

	return resp
}

// getProviderRelationshipStats returns relationship statistics for a provider
func getProviderRelationshipStats(c *gin.Context) {
	providerID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var stats RelationshipStats

	// Count total relationships
	var count int64
	db.Social().Model(&models.ProviderBuyerRelationship{}).
		Where("provider_id = ?", providerID).
		Count(&count)
	stats.TotalRelationships = int(count)

	// Sum bandwidth and revenue
	var totals struct {
		Bandwidth float64
		Revenue   float64
		Sessions  int64
	}
	db.Social().Model(&models.ProviderBuyerRelationship{}).
		Where("provider_id = ?", providerID).
		Select("COALESCE(SUM(total_bandwidth_gb), 0) as bandwidth, COALESCE(SUM(total_spent), 0) as revenue, COALESCE(SUM(total_sessions), 0) as sessions").
		Scan(&totals)

	stats.TotalBandwidthSoldGB = totals.Bandwidth
	stats.TotalRevenue = totals.Revenue
	if stats.TotalRelationships > 0 {
		stats.AvgSessionsPerBuyer = float64(totals.Sessions) / float64(stats.TotalRelationships)
	}

	// Get top 5 buyers by revenue
	var topBuyers []models.ProviderBuyerRelationship
	db.Social().
		Preload("Buyer").
		Where("provider_id = ?", providerID).
		Order("total_spent DESC").
		Limit(5).
		Find(&topBuyers)

	stats.TopBuyers = make([]RelationshipResponse, len(topBuyers))
	for i, r := range topBuyers {
		stats.TopBuyers[i] = mapRelationship(r)
	}

	// Get 5 most recent new relationships
	var recentBuyers []models.ProviderBuyerRelationship
	db.Social().
		Preload("Buyer").
		Where("provider_id = ?", providerID).
		Order("created_at DESC").
		Limit(5).
		Find(&recentBuyers)

	stats.RecentFirstTimeBuyers = make([]RelationshipResponse, len(recentBuyers))
	for i, r := range recentBuyers {
		stats.RecentFirstTimeBuyers[i] = mapRelationship(r)
	}

	c.JSON(http.StatusOK, gin.H{"stats": stats})
}
