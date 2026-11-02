package api

import (
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	providerProofs "github.com/proxyhubb/control-api/internal/proofs"
)

func devListingServerSignEnabled() bool {
	if isTruthyEnv(os.Getenv("PROXYHUB_ALLOW_DEV_LISTING_SIGN")) {
		return providerSigningKeyConfigured()
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("GIN_MODE")), "release") {
		return false
	}
	if env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV"))); env == "production" || env == "prod" {
		return false
	}
	return providerSigningKeyConfigured()
}

func providerSigningKeyConfigured() bool {
	return strings.TrimSpace(os.Getenv("PROXYHUB_PROVIDER_SIGNING_KEY")) != ""
}

// signListingOfferDev signs a listing create payload with PROXYHUB_PROVIDER_SIGNING_KEY (dev/docker only).
func signListingOfferDev(c *gin.Context) {
	if !devListingServerSignEnabled() {
		c.JSON(http.StatusNotFound, gin.H{"error": "dev listing signing is not enabled"})
		return
	}

	userID, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req models.CreateListingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": listingRequestError(err)})
		return
	}

	providerNodeID, err := resolveListingProviderNode(userID, req.ProviderNodeID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if providerNodeID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider_node_id is required"})
		return
	}

	proofContext, hasProofContext, err := loadListingProofContext(userID, providerNodeID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !hasProofContext {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider node not found"})
		return
	}

	priv, pub, err := providerProofs.DecodeSigningKey(os.Getenv("PROXYHUB_PROVIDER_SIGNING_KEY"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server signing key misconfigured"})
		return
	}
	signerHotkey := strings.TrimSpace(proofContext.Hotkey)
	pubB58 := base58.Encode(pub)
	if signerHotkey != "" && signerHotkey != pubB58 {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "server signing key does not match this node's hotkey; use the wallet that matches the node or re-sync with bootstrap -ResyncHotkey",
		})
		return
	}

	rotationType := req.RotationType
	if rotationType == "" {
		rotationType = "static"
	}
	maxConcurrency := req.MaxConcurrency
	if maxConcurrency <= 0 {
		maxConcurrency = 5
	}
	protocol, problem := normalizeListingProtocols(req.Protocol)
	if problem != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": problem, "field": "protocol"})
		return
	}

	country := req.Country
	if country == "" {
		var pn models.ProviderNode
		if db.DB.Select("country").First(&pn, "id = ?", *providerNodeID).Error == nil {
			country = pn.Country
		}
	}

	envelope, err := providerProofs.SignListingOffer(priv, providerProofs.ListingOfferPayload{
		ProviderNodeID:       proofContext.ProviderNodeID,
		GatewayNodeID:        proofContext.GatewayNodeID,
		Title:                req.Title,
		Description:          req.Description,
		ProxyType:            string(req.ProxyType),
		Protocol:             protocol,
		RotationType:         rotationType,
		Country:              country,
		ISP:                  req.ISP,
		PricePerGB:           req.PricePerGB,
		MinPurchaseGB:        req.MinPurchaseGB,
		AvailableBandwidthGB: req.AvailableBandwidthGB,
		MaxConcurrency:       maxConcurrency,
		Status:               string(models.ListingStatusActive),
		ExpiresAt:            req.ListingOfferExpiresAt,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"proof": models.ProviderProof{
			MessageType:    envelope.MessageType,
			Version:        envelope.Version,
			ProviderNodeID: envelope.ProviderNodeID,
			GatewayNodeID:  envelope.GatewayNodeID,
			ProviderHotkey: envelope.ProviderHotkey,
			IssuedAt:       envelope.IssuedAt,
			Nonce:          envelope.Nonce,
			PayloadHash:    envelope.PayloadHash,
			Signature:      envelope.Signature,
		},
		"dev_server_signing": true,
	})
}

func isTruthyEnv(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
