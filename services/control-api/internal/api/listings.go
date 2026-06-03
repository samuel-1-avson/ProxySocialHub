package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/cache"
	"github.com/proxyhubb/control-api/internal/core/domain"
	"github.com/proxyhubb/control-api/internal/core/ports"
	"github.com/proxyhubb/control-api/internal/core/services"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/marketplace/funnel"
	"github.com/proxyhubb/control-api/internal/models"
	providerProofs "github.com/proxyhubb/control-api/internal/proofs"
	"github.com/proxyhubb/control-api/internal/privacy"
)

// getListingProofPolicy exposes whether signed listing offers are mandatory.
func getListingProofPolicy(c *gin.Context) {
	mode := providerProofMode()
	c.JSON(http.StatusOK, gin.H{
		"mode":               mode,
		"required":           mode == "enforce",
		"dev_server_signing": devListingServerSignEnabled(),
	})
}

// RegisterListingRoutes registers marketplace listing routes
func RegisterListingRoutes(rg *gin.RouterGroup) {
	RegisterListingCatalogRoutes(rg)
	rg.GET("/listings", getListings)
	rg.GET("/listings/featured", getFeaturedListings)
	rg.GET("/listings/search", searchListings)
	rg.GET("/listings/my", getMyListings)
	rg.GET("/listings/proof-policy", getListingProofPolicy)
	rg.GET("/listings/:id", getListing)
	rg.POST("/listings", createListing)
	rg.PATCH("/listings/:id", updateListing)
	rg.DELETE("/listings/:id", deleteListing)
	rg.POST("/listings/:id/save", saveListing)
	rg.DELETE("/listings/:id/save", unsaveListing)
	rg.GET("/saved", getSavedListings)
	rg.GET("/my", getMyListings)
	rg.GET("/suggest-price", suggestPrice)
}

// ListingsResponse is the cached response structure
type ListingsResponse struct {
	Listings []models.ProxyListing `json:"listings"`
	Total    int64                 `json:"total"`
	Page     int                   `json:"page"`
	Limit    int                   `json:"limit"`
}

// getListings returns marketplace listings with filters
func getListings(c *gin.Context) {
	filters := buildListingFilters(c)

	// Try cache first
	cacheKey := listingCacheKey(filters)

	var cachedResponse ListingsResponse
	if found, _ := cache.Get(cacheKey, &cachedResponse); found {
		c.JSON(http.StatusOK, cachedResponse)
		return
	}

	entities, total, err := marketplaceServiceOrDefault().BrowseMarket(c.Request.Context(), filters)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to browse marketplace"})
		return
	}

	// Map domain entities back to API response models
	apiListings := make([]models.ProxyListing, len(entities))
	for i, e := range entities {
		listingModel := listingEntityToModel(e)

		// Apply Elastic Pricing adjustment
		listingModel.PricePerGB = CalculateFairPrice(listingModel)

		// Apply ZK-Privacy Obfuscation (Security Audit Sweep)
		sentry := privacy.NewZKMetadataSentry()
		sentry.SanitizeListing(&listingModel)

		apiListings[i] = listingModel
	}

	enrichListingsSLA(apiListings)

	response := ListingsResponse{
		Listings: apiListings,
		Total:    total,
		Page:     getPageParam(c, 1),
		Limit:    getLimitParam(c, 20),
	}

	// Cache result (60 seconds)
	cache.Set(cacheKey, response, 60*time.Second)

	c.JSON(http.StatusOK, response)
}

func buildListingFilters(c *gin.Context) map[string]interface{} {
	filters := map[string]interface{}{
		"page":  getPageParam(c, 1),
		"limit": getLimitParam(c, 20),
	}

	for _, key := range []string{
		"proxy_type",
		"protocol",
		"protocols",
		"rotation_type",
		"country",
		"isp",
		"min_price",
		"max_price",
		"min_rating",
		"min_quality_score",
		"min_success_rate",
		"min_uptime_percent",
		"min_bandwidth_mbps",
		"seller_id",
		"sort_by",
		"sort_order",
	} {
		if value := strings.TrimSpace(c.Query(key)); value != "" {
			filters[key] = value
		}
	}

	if protocols := c.QueryArray("protocols"); len(protocols) > 0 {
		filters["protocols"] = protocols
	}

	return filters
}

func listingCacheKey(filters map[string]interface{}) string {
	keys := make([]string, 0, len(filters))
	for key := range filters {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	values := url.Values{}
	for _, key := range keys {
		values.Set(key, fmt.Sprint(filters[key]))
	}
	return "listings:sla:v2:" + values.Encode()
}

func sellerProfileToModel(p *domain.SellerPublicProfile) *models.User {
	if p == nil {
		return nil
	}
	return &models.User{
		ID:          p.ID,
		DisplayName: p.DisplayName,
		Username:    p.Username,
		AvatarURL:   p.AvatarURL,
		Role:        p.Role,
		TrustTier:   models.TrustTier(p.TrustTier),
	}
}

func listingEntitiesToModels(entities []domain.ListingEntity) []models.ProxyListing {
	out := make([]models.ProxyListing, len(entities))
	for i, e := range entities {
		out[i] = listingEntityToModel(e)
		out[i].Seller = sellerProfileToModel(e.Seller)
	}
	return out
}

func listingViewerFromContext(c *gin.Context) ports.ListingViewer {
	viewer := ports.ListingViewer{
		IsModerator: isPlatformModeratorRole(c.GetString("userRole")),
	}
	if userID, err := parseUserIDFromContext(c); err == nil {
		viewer.UserID = &userID
	}
	return viewer
}

func listingEntityToModel(e domain.ListingEntity) models.ProxyListing {
	return models.ProxyListing{
		ID:                   e.ID,
		SellerID:             e.SellerID,
		ProviderNodeID:       e.ProviderNodeID,
		ListingOfferHash:     e.ListingOfferHash,
		ListingOfferSignature: e.ListingOfferSignature,
		ListingOfferSigner:   e.ListingOfferSigner,
		ListingOfferSignedAt: e.ListingOfferSignedAt,
		ListingOfferVerified: e.ListingOfferVerified,
		ListingOfferVerificationError: e.ListingOfferVerificationError,
		ListingOfferNonce:    e.ListingOfferNonce,
		Title:                e.Title,
		Description:          e.Description,
		PricePerGB:           e.PricePerGB,
		MinPurchaseGB:        e.MinPurchaseGB,
		AvailableBandwidthGB: e.AvailableBandwidthGB,
		MaxConcurrency:       e.MaxConcurrency,
		ProxyType:            models.ProxyType(e.ProxyType),
		Protocol:             e.Protocol,
		RotationType:         e.RotationType,
		Country:              e.Country,
		ISP:                  e.ISP,
		Status:               models.ListingStatus(e.Status),
		QualityScore:         e.QualityScore,
		UptimePercent:        e.UptimePercent,
		AvgLatencyMs:         e.AvgLatencyMs,
		SuccessRate:          e.SuccessRate,
		CurrentTier:          e.CurrentTier,
		ViewsCount:           e.ViewsCount,
		SavesCount:           e.SavesCount,
		OrdersCount:          e.OrdersCount,
		ActiveSessionsCount:  e.ActiveSessionsCount,
		AllowDirectMessage:   e.AllowDirectMessage,
		CreatedAt:            e.CreatedAt,
		UpdatedAt:            e.UpdatedAt,
	}
}

func listingUpdateHasChanges(updates domain.ListingUpdate) bool {
	return updates.Title != nil ||
		updates.Description != nil ||
		updates.PricePerGB != nil ||
		updates.MinPurchaseGB != nil ||
		updates.AvailableBandwidthGB != nil ||
		updates.MaxConcurrency != nil ||
		updates.Status != nil ||
		updates.BulkDiscountsJSON != nil ||
		updates.ListingOfferHash != nil ||
		updates.ListingOfferSignature != nil ||
		updates.ListingOfferSigner != nil ||
		updates.ListingOfferSignedAt != nil ||
		updates.ListingOfferVerified != nil ||
		updates.ListingOfferVerificationError != nil ||
		updates.ListingOfferNonce != nil
}

func writeMarketplaceError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, domain.ErrListingNotFound), errors.Is(err, domain.ErrListingNotSaved):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, domain.ErrListingForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, domain.ErrListingUnavailable), errors.Is(err, domain.ErrListingAlreadySaved):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	}
}

// getListing returns a single listing by ID
func getListing(c *gin.Context) {
	id := strings.ToLower(strings.TrimSpace(c.Param("id")))
	switch id {
	case "geo":
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "endpoint_not_found",
			"message": "Use GET /v1/listings/geo or GET /v1/marketplace/geo",
		})
		return
	case "featured", "search", "facets", "collections":
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "endpoint_not_found",
			"message": "Use GET /v1/listings/" + id,
		})
		return
	}

	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	detail, err := marketplaceServiceOrDefault().GetListingForViewer(
		c.Request.Context(),
		listingID,
		listingViewerFromContext(c),
	)
	if err != nil {
		writeMarketplaceError(c, err)
		return
	}

	listing := listingEntityToModel(detail.Listing)
	listing.Seller = sellerProfileToModel(detail.Seller)
	enrichListingsSLA([]models.ProxyListing{listing})

	sentry := privacy.NewZKMetadataSentry()
	sentry.SanitizeListing(&listing)

	c.JSON(http.StatusOK, gin.H{
		"listing":  listing,
		"is_saved": detail.IsSaved,
	})
}

// createListing creates a new proxy listing
func createListing(c *gin.Context) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	allowed, err := CheckSubscriptionLimits(userID, "listings")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify subscription limits"})
		return
	}
	if !allowed {
		c.JSON(http.StatusForbidden, gin.H{"error": "Listing limit reached for your subscription plan. Upgrade or remove an existing listing."})
		return
	}

	var req models.CreateListingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	providerNodeID, err := resolveListingProviderNode(userID, req.ProviderNodeID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	country := req.Country
	isp := req.ISP
	if providerNodeID != nil && (country == "" || isp == "") {
		var pn models.ProviderNode
		if db.DB.Select("country", "city").First(&pn, "id = ?", *providerNodeID).Error == nil {
			if country == "" {
				country = pn.Country
			}
		}
	}

	rotationType := req.RotationType
	if rotationType == "" {
		rotationType = "static"
	}
	maxConcurrency := req.MaxConcurrency
	if maxConcurrency <= 0 {
		maxConcurrency = 5
	}

	entity := domain.ListingEntity{
		ProviderNodeID:       providerNodeID,
		Title:                req.Title,
		Description:          req.Description,
		PricePerGB:           req.PricePerGB,
		MinPurchaseGB:        req.MinPurchaseGB,
		AvailableBandwidthGB: req.AvailableBandwidthGB,
		MaxConcurrency:       maxConcurrency,
		ProxyType:            domain.ProxyType(req.ProxyType),
		Protocol:             req.Protocol,
		RotationType:         rotationType,
		Country:              country,
		ISP:                  isp,
	}

	proofContext, hasProofContext, err := loadListingProofContext(userID, providerNodeID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if providerProofPresent(req.Proof) && !hasProofContext {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider-signed listings require a provider node"})
		return
	}
	if hasProofContext {
		payloadHash := providerProofs.HashListingOfferPayload(providerProofs.ListingOfferPayload{
			ProviderNodeID:       proofContext.ProviderNodeID,
			GatewayNodeID:        proofContext.GatewayNodeID,
			Title:                req.Title,
			Description:          req.Description,
			ProxyType:            string(req.ProxyType),
			Protocol:             req.Protocol,
			RotationType:         rotationType,
			Country:              country,
			ISP:                  isp,
			PricePerGB:           req.PricePerGB,
			MinPurchaseGB:        req.MinPurchaseGB,
			AvailableBandwidthGB: req.AvailableBandwidthGB,
			MaxConcurrency:       maxConcurrency,
			Status:               string(models.ListingStatusActive),
			ExpiresAt:            req.ListingOfferExpiresAt,
		})
		proofResult := verifyProviderProof(req.Proof, providerProofs.ListingOfferMessageType, proofContext.Hotkey, payloadHash)
		if proofResult.Present && !proofResult.Verified {
			c.JSON(http.StatusForbidden, gin.H{"error": "invalid provider listing proof", "details": proofResult.VerificationError})
			return
		}
		if providerProofRequired() && !proofResult.Verified {
			c.JSON(http.StatusForbidden, gin.H{"error": "provider listing proof required"})
			return
		}
		if proofResult.Verified {
			maybeBindProviderHotkey(proofContext.ProviderNodeID, userID, proofResult.Signer, true)
		}
		entity.ListingOfferHash = proofResult.Hash
		entity.ListingOfferSignature = proofResult.Signature
		entity.ListingOfferSigner = proofResult.Signer
		entity.ListingOfferSignedAt = proofResult.SignedAt
		entity.ListingOfferVerified = proofResult.Verified
		entity.ListingOfferVerificationError = proofResult.VerificationError
		entity.ListingOfferNonce = proofResult.Nonce
	}

	published, err := marketplaceServiceOrDefault().PublishListing(c.Request.Context(), userID, entity)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	invalidateMarketplaceReadModels()
	publishNewListingFeedEvent(userID, *published)

	c.JSON(http.StatusCreated, listingEntityToModel(*published))
}

// resolveListingProviderNode picks or validates the provider_nodes row for a listing.
func resolveListingProviderNode(sellerID uuid.UUID, requested *uuid.UUID) (*uuid.UUID, error) {
	if requested != nil && *requested != uuid.Nil {
		var count int64
		if err := db.DB.Model(&models.ProviderNode{}).
			Where("id = ? AND user_id = ?", *requested, sellerID).
			Count(&count).Error; err != nil {
			return nil, err
		}
		if count == 0 {
			return nil, fmt.Errorf("provider node not found or not owned by you")
		}
		return requested, nil
	}

	var pn models.ProviderNode
	err := db.DB.Where("user_id = ?", sellerID).
		Order("CASE WHEN status = 'online' THEN 0 ELSE 1 END, last_seen_at DESC NULLS LAST, created_at DESC").
		First(&pn).Error
	if err != nil {
		return nil, nil
	}
	return &pn.ID, nil
}

type listingProofContext struct {
	ProviderNodeID uuid.UUID
	GatewayNodeID  string
	Hotkey         string
}

func loadListingProofContext(sellerID uuid.UUID, providerNodeID *uuid.UUID) (listingProofContext, bool, error) {
	if providerNodeID == nil || *providerNodeID == uuid.Nil {
		return listingProofContext{}, false, nil
	}
	var pn models.ProviderNode
	if err := db.DB.Select("id", "gateway_node_id", "hotkey").
		Where("id = ? AND user_id = ?", *providerNodeID, sellerID).
		First(&pn).Error; err != nil {
		return listingProofContext{}, false, fmt.Errorf("provider node not found or not owned by you")
	}
	return listingProofContext{
		ProviderNodeID: pn.ID,
		GatewayNodeID:  pn.GatewayNodeID,
		Hotkey:         pn.Hotkey,
	}, true, nil
}

// updateListing updates an existing listing
func updateListing(c *gin.Context) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	var req models.UpdateListingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := domain.ListingUpdate{}
	if req.Title != nil {
		updates.Title = req.Title
	}
	if req.Description != nil {
		updates.Description = req.Description
	}
	if req.PricePerGB != nil {
		updates.PricePerGB = req.PricePerGB
	}
	if req.MinPurchaseGB != nil {
		updates.MinPurchaseGB = req.MinPurchaseGB
	}
	if req.AvailableBandwidthGB != nil {
		updates.AvailableBandwidthGB = req.AvailableBandwidthGB
	}
	if req.MaxConcurrency != nil {
		updates.MaxConcurrency = req.MaxConcurrency
	}
	if req.Status != nil {
		status := domain.ListingStatus(*req.Status)
		updates.Status = &status
	}
	if len(req.BulkDiscounts) > 0 {
		discountsJSON, _ := json.Marshal(req.BulkDiscounts)
		updates.BulkDiscountsJSON = discountsJSON
	}

	if providerProofPresent(req.Proof) || providerProofRequired() {
		var existing models.ProxyListing
		if err := db.DB.Where("id = ? AND seller_id = ? AND status != ?", listingID, userID, models.ListingStatusDeleted).
			First(&existing).Error; err != nil {
			writeMarketplaceError(c, domain.ErrListingNotFound)
			return
		}
		proofContext, hasProofContext, err := loadListingProofContext(userID, existing.ProviderNodeID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if providerProofPresent(req.Proof) && !hasProofContext {
			c.JSON(http.StatusBadRequest, gin.H{"error": "provider-signed listings require a provider node"})
			return
		}
		if hasProofContext {
			title := existing.Title
			if req.Title != nil {
				title = *req.Title
			}
			description := existing.Description
			if req.Description != nil {
				description = *req.Description
			}
			pricePerGB := existing.PricePerGB
			if req.PricePerGB != nil {
				pricePerGB = *req.PricePerGB
			}
			minPurchaseGB := existing.MinPurchaseGB
			if req.MinPurchaseGB != nil {
				minPurchaseGB = *req.MinPurchaseGB
			}
			availableBandwidthGB := existing.AvailableBandwidthGB
			if req.AvailableBandwidthGB != nil {
				availableBandwidthGB = *req.AvailableBandwidthGB
			}
			maxConcurrency := existing.MaxConcurrency
			if req.MaxConcurrency != nil {
				maxConcurrency = *req.MaxConcurrency
			}
			status := existing.Status
			if req.Status != nil {
				status = *req.Status
			}
			payloadHash := providerProofs.HashListingOfferPayload(providerProofs.ListingOfferPayload{
				ProviderNodeID:       proofContext.ProviderNodeID,
				GatewayNodeID:        proofContext.GatewayNodeID,
				Title:                title,
				Description:          description,
				ProxyType:            string(existing.ProxyType),
				Protocol:             existing.Protocol,
				RotationType:         existing.RotationType,
				Country:              existing.Country,
				ISP:                  existing.ISP,
				PricePerGB:           pricePerGB,
				MinPurchaseGB:        minPurchaseGB,
				AvailableBandwidthGB: availableBandwidthGB,
				MaxConcurrency:       maxConcurrency,
				Status:               string(status),
				ExpiresAt:            req.ListingOfferExpiresAt,
			})
			proofResult := verifyProviderProof(req.Proof, providerProofs.ListingOfferMessageType, proofContext.Hotkey, payloadHash)
			if proofResult.Present && !proofResult.Verified {
				c.JSON(http.StatusForbidden, gin.H{"error": "invalid provider listing proof", "details": proofResult.VerificationError})
				return
			}
			if providerProofRequired() && !proofResult.Verified {
				c.JSON(http.StatusForbidden, gin.H{"error": "provider listing proof required"})
				return
			}
			if proofResult.Verified {
				maybeBindProviderHotkey(proofContext.ProviderNodeID, userID, proofResult.Signer, true)
			}
			updates.ListingOfferHash = &proofResult.Hash
			updates.ListingOfferSignature = &proofResult.Signature
			updates.ListingOfferSigner = &proofResult.Signer
			updates.ListingOfferSignedAt = proofResult.SignedAt
			updates.ListingOfferVerified = &proofResult.Verified
			updates.ListingOfferVerificationError = &proofResult.VerificationError
			updates.ListingOfferNonce = &proofResult.Nonce
		}
	}

	updated, err := marketplaceServiceOrDefault().UpdateListing(c.Request.Context(), userID, listingID, updates)
	if err != nil {
		writeMarketplaceError(c, err)
		return
	}
	if listingUpdateHasChanges(updates) {
		invalidateMarketplaceReadModels()
	}

	c.JSON(http.StatusOK, listingEntityToModel(*updated))
}

// deleteListing soft-deletes a listing
func deleteListing(c *gin.Context) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	if err := marketplaceServiceOrDefault().DeleteListing(c.Request.Context(), userID, listingID); err != nil {
		writeMarketplaceError(c, err)
		return
	}

	invalidateMarketplaceReadModels()
	c.JSON(http.StatusOK, gin.H{"message": "Listing deleted"})
}

// saveListing bookmarks a listing
func saveListing(c *gin.Context) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	if err := marketplaceServiceOrDefault().SaveListing(c.Request.Context(), userID, listingID); err != nil {
		writeMarketplaceError(c, err)
		return
	}

	invalidateMarketplaceReadModels()

	funnel.Record(c.Request.Context(), funnel.RecordParams{
		EventName: models.FunnelListingSave,
		UserID:    &userID,
		ListingID: &listingID,
		Surface:   "api",
	})

	c.JSON(http.StatusOK, gin.H{"message": "Listing saved"})
}

// unsaveListing removes a bookmark
func unsaveListing(c *gin.Context) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	if err := marketplaceServiceOrDefault().UnsaveListing(c.Request.Context(), userID, listingID); err != nil {
		writeMarketplaceError(c, err)
		return
	}

	invalidateMarketplaceReadModels()
	c.JSON(http.StatusOK, gin.H{"message": "Listing unsaved"})
}

// getSavedListings returns user's saved listings
func getSavedListings(c *gin.Context) {
	userID, err := parseUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)

	entries, total, err := marketplaceServiceOrDefault().GetSavedListings(c.Request.Context(), userID, page, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch saved listings"})
		return
	}

	saved := make([]models.SavedListing, len(entries))
	for i, entry := range entries {
		listing := listingEntityToModel(entry.Listing)
		listing.Seller = sellerProfileToModel(entry.Seller)
		saved[i] = models.SavedListing{
			UserID:    entry.UserID,
			ListingID: entry.ListingID,
			CreatedAt: entry.CreatedAt,
			Listing:   &listing,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"saved": saved,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

// getMyListings returns the current user's listings
func getMyListings(c *gin.Context) {
	userID, err := parseUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)

	entities, total, err := marketplaceServiceOrDefault().GetSellerListings(c.Request.Context(), userID, page, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch listings"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"listings": listingEntitiesToModels(entities),
		"total":    total,
		"page":     page,
		"limit":    limit,
	})
}

// suggestPrice returns a recommended price based on node attributes
func suggestPrice(c *gin.Context) {
	country := c.Query("country")
	proxyType := c.Query("proxy_type")

	if country == "" || proxyType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "country and proxy_type are required"})
		return
	}

	oracle := services.NewPricingOracle()
	suggestion, err := oracle.SuggestPrice(c.Request.Context(), country, proxyType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate price suggestion"})
		return
	}

	c.JSON(http.StatusOK, suggestion)
}

// getFeaturedListings returns top-ranked active listings (high quality score, priority)
func getFeaturedListings(c *gin.Context) {
	entities, err := marketplaceServiceOrDefault().GetFeaturedListings(c.Request.Context(), 12)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch featured listings"})
		return
	}

	listings := listingEntitiesToModels(entities)
	sentry := privacy.NewZKMetadataSentry()
	for i := range listings {
		sentry.SanitizeListing(&listings[i])
	}

	c.JSON(http.StatusOK, gin.H{"listings": listings, "total": len(listings)})
}

// searchListings searches listings using PostgreSQL full-text search (E4).
// Falls back to ILIKE if the search_vector column does not yet exist (pre-migration).
func searchListings(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "query parameter 'q' is required"})
		return
	}

	entities, err := marketplaceServiceOrDefault().SearchListings(c.Request.Context(), q)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	listings := listingEntitiesToModels(entities)
	sentry := privacy.NewZKMetadataSentry()
	for i := range listings {
		sentry.SanitizeListing(&listings[i])
	}

	c.JSON(http.StatusOK, gin.H{"listings": listings, "total": len(listings)})
}

func canViewPendingReviewListing(c *gin.Context, sellerID uuid.UUID) bool {
	if isPlatformModeratorRole(c.GetString("userRole")) {
		return true
	}
	userID, err := parseUserIDFromContext(c)
	return err == nil && userID == sellerID
}

func isPlatformModeratorRole(role string) bool {
	switch role {
	case "admin", "moderator", "superadmin":
		return true
	default:
		return false
	}
}

func parseUserIDFromContext(c *gin.Context) (uuid.UUID, error) {
	if uid, ok := c.Get("user_id"); ok {
		if id, ok := uid.(uuid.UUID); ok {
			return id, nil
		}
	}
	if userIDStr := c.GetString("userID"); userIDStr != "" {
		return uuid.Parse(userIDStr)
	}
	return uuid.Nil, fmt.Errorf("no user in context")
}
