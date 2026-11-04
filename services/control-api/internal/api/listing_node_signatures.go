package api

// Node-signed listing offers.
//
// A listing offer must be signed with the key of the node that supplies it (see
// provider_proofs.go). That key is provider_signing_key in provider.toml on the
// provider's own computer, so a browser that did not set the node up cannot sign,
// and asking people to dig the key out of an application-data folder and paste it
// failed in practice. Instead the browser asks the node to sign:
//
//  1. Browser: POST /v1/provider/listings/offer-signatures with the exact create
//     (or edit) request it is about to send. The server builds the payload that
//     createListing / updateListing will verify (same helpers) and parks a
//     short-lived request in Redis.
//  2. Node: long-polls GET /v1/provider/nodes/:id/offer-signatures, rebuilds the
//     payload hash itself from the fields, signs it with its key and posts the
//     proof to POST /v1/provider/nodes/:id/offer-signatures/:rid. The proof is
//     checked against the node's registered hotkey before it is accepted.
//  3. Browser: polls GET /v1/provider/listings/offer-signatures/:rid and then
//     sends the create/edit request with that proof.
//
// Listing verification itself is unchanged, and the key never leaves the node.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/core/services"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	providerProofs "github.com/proxyhubb/control-api/internal/proofs"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

const (
	// A request lives as long as a proof is accepted (providerProofMaxAge).
	offerSignRequestTTL = providerProofMaxAge
	// Each node keeps at most this many request ids; older ones fall off.
	offerSignMaxPerNode = 10
	// A node counts as listening this long after it last asked for work. The node
	// asks again as soon as each long poll returns, so this only has to outlast one
	// poll plus a reconnect.
	offerSignListeningTTL = 45 * time.Second
	// The longest a node's poll is held open. Cloudflare and Caddy allow far more.
	offerSignMaxWait = 25 * time.Second

	offerSignStatusPending = "pending"
	offerSignStatusSigned  = "signed"
	offerSignStatusRefused = "refused"
)

// How often a held poll re-reads Redis. A variable so tests can run quickly.
var offerSignPollInterval = time.Second

var errOfferSignUnavailable = errors.New("node signing is unavailable right now")

// offerSignPayload is providerProofs.ListingOfferPayload as sent to the node. Numbers
// travel as the shortest decimal string that round-trips (strconv 'f', -1): the node
// parses them back to the identical float64 and formats them with %.9f exactly as
// HashListingOfferPayload does, so both sides hash the same bytes.
type offerSignPayload struct {
	ProviderNodeID       string `json:"provider_node_id"`
	GatewayNodeID        string `json:"gateway_node_id"`
	Title                string `json:"title"`
	Description          string `json:"description"`
	ProxyType            string `json:"proxy_type"`
	Protocol             string `json:"protocol"`
	RotationType         string `json:"rotation_type"`
	Country              string `json:"country"`
	ISP                  string `json:"isp"`
	PricePerGB           string `json:"price_per_gb"`
	MinPurchaseGB        string `json:"min_purchase_gb"`
	AvailableBandwidthGB string `json:"available_bandwidth_gb"`
	MaxConcurrency       int    `json:"max_concurrency"`
	Status               string `json:"status"`
	ExpiresAt            int64  `json:"expires_at"`
}

func newOfferSignPayload(p providerProofs.ListingOfferPayload) offerSignPayload {
	num := func(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
	return offerSignPayload{
		ProviderNodeID:       p.ProviderNodeID.String(),
		GatewayNodeID:        p.GatewayNodeID,
		Title:                p.Title,
		Description:          p.Description,
		ProxyType:            p.ProxyType,
		Protocol:             p.Protocol,
		RotationType:         p.RotationType,
		Country:              p.Country,
		ISP:                  p.ISP,
		PricePerGB:           num(p.PricePerGB),
		MinPurchaseGB:        num(p.MinPurchaseGB),
		AvailableBandwidthGB: num(p.AvailableBandwidthGB),
		MaxConcurrency:       p.MaxConcurrency,
		Status:               p.Status,
		ExpiresAt:            p.ExpiresAt,
	}
}

// offerSignRequest is one browser's request for a node signature, kept in Redis.
type offerSignRequest struct {
	ID             string                `json:"id"`
	UserID         string                `json:"user_id"`
	ProviderNodeID string                `json:"provider_node_id"`
	ListingID      string                `json:"listing_id,omitempty"`
	Payload        offerSignPayload      `json:"payload"`
	PayloadHash    string                `json:"payload_hash"`
	Status         string                `json:"status"`
	Proof          *models.ProviderProof `json:"proof,omitempty"`
	Error          string                `json:"error,omitempty"`
	CreatedAt      int64                 `json:"created_at"`
	ExpiresAt      int64                 `json:"expires_at"`
}

func offerSignRequestKey(id string) string  { return "offer_sign:req:" + id }
func offerSignNodeKey(nodeID string) string { return "offer_sign:node:" + nodeID }
func offerSignListeningKey(nodeID string) string {
	return "offer_sign:listening:" + nodeID
}

func saveOfferSignRequest(ctx context.Context, req offerSignRequest) error {
	if redisClient.Client == nil {
		return errOfferSignUnavailable
	}
	ttl := time.Until(time.Unix(req.ExpiresAt, 0))
	if ttl <= 0 {
		return errors.New("signing request expired")
	}
	raw, err := json.Marshal(req)
	if err != nil {
		return err
	}
	return redisClient.Client.Set(ctx, offerSignRequestKey(req.ID), raw, ttl).Err()
}

func loadOfferSignRequest(ctx context.Context, id string) (offerSignRequest, bool) {
	if redisClient.Client == nil {
		return offerSignRequest{}, false
	}
	raw, err := redisClient.Client.Get(ctx, offerSignRequestKey(id)).Result()
	if err != nil || raw == "" {
		return offerSignRequest{}, false
	}
	var req offerSignRequest
	if json.Unmarshal([]byte(raw), &req) != nil {
		return offerSignRequest{}, false
	}
	return req, true
}

// enqueueOfferSignRequest stores the request and adds it to its node's queue.
func enqueueOfferSignRequest(ctx context.Context, req offerSignRequest) error {
	if err := saveOfferSignRequest(ctx, req); err != nil {
		return err
	}
	key := offerSignNodeKey(req.ProviderNodeID)
	pipe := redisClient.Client.Pipeline()
	pipe.LPush(ctx, key, req.ID)
	pipe.LTrim(ctx, key, 0, offerSignMaxPerNode-1)
	pipe.Expire(ctx, key, offerSignRequestTTL)
	_, err := pipe.Exec(ctx)
	return err
}

// pendingOfferSignRequests lists the node's requests still waiting for a signature,
// oldest first.
func pendingOfferSignRequests(ctx context.Context, userID, nodeID string) []offerSignRequest {
	if redisClient.Client == nil {
		return nil
	}
	ids, err := redisClient.Client.LRange(ctx, offerSignNodeKey(nodeID), 0, offerSignMaxPerNode-1).Result()
	if err != nil || len(ids) == 0 {
		return nil
	}
	keys := make([]string, len(ids))
	for i, id := range ids {
		keys[i] = offerSignRequestKey(id)
	}
	values, err := redisClient.Client.MGet(ctx, keys...).Result()
	if err != nil {
		return nil
	}
	now := time.Now().Unix()
	pending := []offerSignRequest{}
	for i := len(values) - 1; i >= 0; i-- {
		raw, ok := values[i].(string)
		if !ok || raw == "" {
			continue
		}
		var req offerSignRequest
		if json.Unmarshal([]byte(raw), &req) != nil {
			continue
		}
		if req.Status != offerSignStatusPending || req.UserID != userID || req.ProviderNodeID != nodeID || req.ExpiresAt <= now {
			continue
		}
		pending = append(pending, req)
	}
	return pending
}

func offerSignerListening(ctx context.Context, nodeID string) bool {
	if redisClient.Client == nil {
		return false
	}
	n, err := redisClient.Client.Exists(ctx, offerSignListeningKey(nodeID)).Result()
	return err == nil && n > 0
}

// offerSignatureCreateBody carries either a new listing (listing) or an edit
// (listing_id + update), exactly as the browser will send it afterwards.
type offerSignatureCreateBody struct {
	Listing   *models.CreateListingRequest `json:"listing"`
	ListingID string                       `json:"listing_id"`
	Update    *models.UpdateListingRequest `json:"update"`
}

// requestOfferSignature parks a request for the node to sign an offer.
// POST /v1/provider/listings/offer-signatures
func requestOfferSignature(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	var body offerSignatureCreateBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": listingRequestError(err)})
		return
	}

	var (
		payload      providerProofs.ListingOfferPayload
		proofContext listingProofContext
		listingID    string
	)
	switch {
	case body.Listing != nil && body.Update == nil:
		req := *body.Listing
		protocol, problem := normalizeListingProtocols(req.Protocol)
		if problem != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": problem, "field": "protocol"})
			return
		}
		req.Protocol = protocol
		if _, hard := services.ValidateListingPriceUSD(req.PricePerGB, req.Country, string(req.ProxyType)); hard != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": hard})
			return
		}
		terms, err := resolveListingCreateTerms(userID, req)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if terms.ProviderNodeID == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Choose the node that supplies this offer."})
			return
		}
		ctx, _, err := loadListingProofContext(userID, terms.ProviderNodeID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		proofContext = ctx
		payload = listingCreateOfferPayload(proofContext, req, terms)
	case body.Update != nil && body.Listing == nil:
		id, err := uuid.Parse(strings.TrimSpace(body.ListingID))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
			return
		}
		var existing models.ProxyListing
		if err := db.DB.Where("id = ? AND seller_id = ? AND status != ?", id, userID, models.ListingStatusDeleted).
			First(&existing).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
			return
		}
		if existing.ProviderNodeID == nil || *existing.ProviderNodeID == uuid.Nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "This offer is not bound to a node, so no node can sign it."})
			return
		}
		ctx, _, err := loadListingProofContext(userID, existing.ProviderNodeID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		proofContext = ctx
		payload = listingUpdateOfferPayload(proofContext, existing, *body.Update)
		listingID = id.String()
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Send either a new listing or a listing_id with its update."})
		return
	}

	if strings.TrimSpace(proofContext.Hotkey) == "" {
		c.JSON(http.StatusConflict, gin.H{
			"error": "This node has not connected yet. Start it once so it registers its signing key, then publish the offer.",
			"code":  "node_hotkey_missing",
		})
		return
	}

	now := time.Now()
	req := offerSignRequest{
		ID:             uuid.NewString(),
		UserID:         userID.String(),
		ProviderNodeID: proofContext.ProviderNodeID.String(),
		ListingID:      listingID,
		Payload:        newOfferSignPayload(payload),
		PayloadHash:    providerProofs.HashListingOfferPayload(payload),
		Status:         offerSignStatusPending,
		CreatedAt:      now.Unix(),
		ExpiresAt:      now.Add(offerSignRequestTTL).Unix(),
	}
	if err := enqueueOfferSignRequest(c.Request.Context(), req); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": errOfferSignUnavailable.Error(), "code": "offer_signing_unavailable"})
		return
	}
	c.JSON(http.StatusCreated, offerSignatureView(c.Request.Context(), req))
}

func offerSignatureView(ctx context.Context, req offerSignRequest) gin.H {
	view := gin.H{
		"id":               req.ID,
		"provider_node_id": req.ProviderNodeID,
		"status":           req.Status,
		"node_listening":   offerSignerListening(ctx, req.ProviderNodeID),
		"expires_at":       req.ExpiresAt,
	}
	if req.ListingID != "" {
		view["listing_id"] = req.ListingID
	}
	if req.Proof != nil {
		view["proof"] = req.Proof
	}
	if req.Error != "" {
		view["error"] = req.Error
	}
	return view
}

// getOfferSignature reports whether the node has signed yet.
// GET /v1/provider/listings/offer-signatures/:id
func getOfferSignature(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	req, found := loadOfferSignRequest(c.Request.Context(), c.Param("id"))
	if !found || req.UserID != userID.String() {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "This signing request has expired. Publish the offer again.",
			"code":  "offer_signature_expired",
		})
		return
	}
	c.JSON(http.StatusOK, offerSignatureView(c.Request.Context(), req))
}

// getOfferSignerStatus tells the browser whether the node is asking for work, so
// the page can say up front whether the node will sign automatically.
// GET /v1/provider/nodes/:id/offer-signer
func getOfferSignerStatus(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	nodeID, ok := ownedProviderNodeParam(c, userID)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"listening": offerSignerListening(c.Request.Context(), nodeID.String())})
}

func ownedProviderNodeParam(c *gin.Context, userID uuid.UUID) (uuid.UUID, bool) {
	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node ID"})
		return uuid.Nil, false
	}
	var count int64
	if err := db.DB.Model(&models.ProviderNode{}).
		Where("id = ? AND user_id = ?", nodeID, userID).
		Count(&count).Error; err != nil || count == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
		return uuid.Nil, false
	}
	return nodeID, true
}

type offerSignWork struct {
	ID          string           `json:"id"`
	ListingID   string           `json:"listing_id,omitempty"`
	Payload     offerSignPayload `json:"payload"`
	PayloadHash string           `json:"payload_hash"`
	RequestedAt int64            `json:"requested_at"`
}

// pollOfferSignatures hands the node the offers waiting for its signature. With
// ?wait=N (seconds, at most 25) it holds the request open until work arrives.
// GET /v1/provider/nodes/:id/offer-signatures
func pollOfferSignatures(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	nodeID, ok := ownedProviderNodeParam(c, userID)
	if !ok {
		return
	}
	if redisClient.Client == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": errOfferSignUnavailable.Error(), "code": "offer_signing_unavailable"})
		return
	}
	wait := time.Duration(0)
	if raw := strings.TrimSpace(c.Query("wait")); raw != "" {
		if secs, err := strconv.Atoi(raw); err == nil && secs > 0 {
			wait = time.Duration(secs) * time.Second
		}
	}
	if wait > offerSignMaxWait {
		wait = offerSignMaxWait
	}

	ctx := c.Request.Context()
	node := nodeID.String()
	_ = redisClient.Client.Set(ctx, offerSignListeningKey(node), "1", offerSignListeningTTL).Err()

	deadline := time.Now().Add(wait)
	for {
		pending := pendingOfferSignRequests(ctx, userID.String(), node)
		if len(pending) > 0 || !time.Now().Before(deadline) {
			work := make([]offerSignWork, 0, len(pending))
			for _, req := range pending {
				work = append(work, offerSignWork{
					ID:          req.ID,
					ListingID:   req.ListingID,
					Payload:     req.Payload,
					PayloadHash: req.PayloadHash,
					RequestedAt: req.CreatedAt,
				})
			}
			c.JSON(http.StatusOK, gin.H{"requests": work})
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(offerSignPollInterval):
		}
	}
}

type offerSignatureAnswer struct {
	Proof   models.ProviderProof `json:"proof"`
	Refused string               `json:"refused"`
}

// answerOfferSignature takes the node's proof (or its refusal) for one request.
// POST /v1/provider/nodes/:id/offer-signatures/:rid
func answerOfferSignature(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	nodeID, ok := ownedProviderNodeParam(c, userID)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	req, found := loadOfferSignRequest(ctx, c.Param("rid"))
	if !found || req.UserID != userID.String() || req.ProviderNodeID != nodeID.String() {
		c.JSON(http.StatusNotFound, gin.H{"error": "Signing request not found or expired"})
		return
	}
	if req.Status != offerSignStatusPending {
		c.JSON(http.StatusConflict, gin.H{"error": "Signing request already answered", "status": req.Status})
		return
	}
	var answer offerSignatureAnswer
	if err := c.ShouldBindJSON(&answer); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid answer"})
		return
	}

	if refused := strings.TrimSpace(answer.Refused); refused != "" {
		req.Status = offerSignStatusRefused
		req.Error = "Your node declined to sign this offer: " + truncateOfferSignText(refused, 300)
		if err := saveOfferSignRequest(ctx, req); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": errOfferSignUnavailable.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": req.Status})
		return
	}

	proofContext, _, err := loadListingProofContext(userID, &nodeID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	result := verifyProviderProof(answer.Proof, providerProofs.ListingOfferMessageType, strings.TrimSpace(proofContext.Hotkey), req.PayloadHash)
	if strings.TrimSpace(proofContext.Hotkey) == "" {
		result.Verified = false
		result.VerificationError = "node has no registered signing key"
	}
	if result.Verified && strings.TrimSpace(answer.Proof.ProviderNodeID) != nodeID.String() {
		result.Verified = false
		result.VerificationError = "proof names a different node"
	}
	if !result.Verified {
		// Tell the browser now instead of letting it wait out its timeout: a node
		// whose signature does not verify (an older build hashing differently, or a
		// key that is not the registered one) will not do better on a retry.
		req.Status = offerSignStatusRefused
		req.Error = "Your node's signature did not match this offer (" + result.VerificationError + "). Update the node, or paste its signing key instead."
		_ = saveOfferSignRequest(ctx, req)
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid listing proof", "details": result.VerificationError})
		return
	}
	proof := answer.Proof
	req.Status = offerSignStatusSigned
	req.Proof = &proof
	if err := saveOfferSignRequest(ctx, req); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": errOfferSignUnavailable.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": req.Status})
}

func truncateOfferSignText(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max])
}
