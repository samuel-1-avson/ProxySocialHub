package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/geoip"
	"github.com/proxyhubb/control-api/internal/indexer"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/settlement"
	"gorm.io/gorm"
)

// RegisterGatewayRoutes registers gateway-specific routes (called by Edge Gateway)
func RegisterGatewayRoutes(rg *gin.RouterGroup, cfg *config.Config) {
	gateway := rg.Group("/gateway")
	gateway.Use(requireGatewayAuth(cfg))
	{
		// Node registration and heartbeat
		gateway.POST("/nodes/register", registerGatewayNode)
		gateway.POST("/nodes/:id/heartbeat", updateGatewayNodeHeartbeat)
		gateway.POST("/nodes/:id/status", updateGatewayNodeStatus)
		gateway.POST("/session-intents/:id/state", updateGatewaySessionIntentState)
		gateway.POST("/session-intents/:id/usage", updateGatewaySessionIntentUsage)
		// Sprint J0: edge Redis-miss hydrate from PG dual-write cache
		gateway.GET("/sessions/hydrate", hydrateGatewaySession)
		// Wave 5.B: honeytoken → observe-only slash audit (no on-chain slash)
		gateway.POST("/slash-audit", recordGatewaySlashAudit)
		RegisterGatewayUsageRoutes(gateway)
	}
}

type GatewaySessionIntentStateRequest struct {
	LifecycleState string `json:"lifecycle_state" binding:"required"`
	ProviderNodeID string `json:"provider_node_id"`
	TargetHost     string `json:"target_host"`
}

type GatewaySessionIntentUsageRequest struct {
	ProviderNodeID string `json:"provider_node_id"`
	TargetHost     string `json:"target_host"`
	BytesUpDelta   int64  `json:"bytes_up_delta"`
	BytesDownDelta int64  `json:"bytes_down_delta"`
}

func updateGatewaySessionIntentState(c *gin.Context) {
	intentID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid session intent ID"})
		return
	}

	var req GatewaySessionIntentStateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var record models.SessionIntentRecord
	if err := db.DB.Where("id = ? AND deleted_at IS NULL", intentID).First(&record).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session intent not found"})
		return
	}
	if err := syncSessionIntentExpiration(&record); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to refresh session intent state"})
		return
	}

	now := time.Now().UTC()
	updates := map[string]interface{}{
		"last_seen_at": now,
	}
	if providerNodeID := strings.TrimSpace(req.ProviderNodeID); providerNodeID != "" {
		updates["provider_node_id"] = providerNodeID
	}
	if targetHost := strings.TrimSpace(req.TargetHost); targetHost != "" {
		updates["target_host"] = targetHost
	}

	nextState := models.SessionIntentLifecycle(strings.TrimSpace(req.LifecycleState))
	if !isSupportedGatewaySessionIntentLifecycle(nextState) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported lifecycle_state"})
		return
	}
	if !canAdvanceGatewaySessionIntentLifecycle(record.LifecycleState, nextState) {
		c.JSON(http.StatusConflict, gin.H{"error": "Invalid lifecycle transition"})
		return
	}

	if nextState.IsPreActivation() && now.After(record.ExpiresAt) {
		nextState = models.SessionIntentExpired
	}
	if nextState == models.SessionIntentActive && record.ExpiresAt.Before(now) && record.LifecycleState.IsPreActivation() {
		nextState = models.SessionIntentExpired
	}
	if nextState == models.SessionIntentActive && intentRequiresFundedSessionPDA(&record) {
		c.JSON(http.StatusPaymentRequired, gin.H{
			"error": "Prepaid session escrow required before activation",
			"code":  "session_escrow_required",
			"next":  "POST /v1/sessions/intents/" + intentID.String() + "/fund/solana",
		})
		return
	}
	applySessionIntentLifecycleTransition(&record, updates, nextState, now)

	if err := db.DB.Model(&record).Updates(updates).Error; err != nil {
		logging.Error(err).Str("intent_id", intentID.String()).Msg("Failed to update session intent state")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update session intent state"})
		return
	}

	if err := db.DB.Where("id = ?", intentID).First(&record).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reload session intent state"})
		return
	}

	if nextState == models.SessionIntentLedgerCommitted || nextState == models.SessionIntentClosing {
		if err := settlement.SettleSessionIntent(intentID); err != nil {
			logging.Error(err).Str("intent_id", intentID.String()).Msg("Failed to settle session intent usage")
			// Still return status — usage is durable; settle can be retried.
		} else if err := db.DB.Where("id = ?", intentID).First(&record).Error; err == nil {
			// refresh after settle/archive
		}
	}

	c.JSON(http.StatusOK, buildSessionIntentStatusResponse(&record))
}

func updateGatewaySessionIntentUsage(c *gin.Context) {
	intentID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid session intent ID"})
		return
	}

	var req GatewaySessionIntentUsageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var record models.SessionIntentRecord
	if err := db.DB.Where("id = ? AND deleted_at IS NULL", intentID).First(&record).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session intent not found"})
		return
	}

	if err := syncSessionIntentExpiration(&record); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to refresh session intent state"})
		return
	}

	now := time.Now().UTC()
	updates := map[string]interface{}{
		"last_seen_at":          now,
		"last_metered_at":       now,
		"last_bytes_up_delta":   req.BytesUpDelta,
		"last_bytes_down_delta": req.BytesDownDelta,
	}
	if providerNodeID := strings.TrimSpace(req.ProviderNodeID); providerNodeID != "" {
		updates["provider_node_id"] = providerNodeID
	}
	if targetHost := strings.TrimSpace(req.TargetHost); targetHost != "" {
		updates["target_host"] = targetHost
	}
	if req.BytesUpDelta != 0 {
		updates["total_bytes_up"] = gorm.Expr("COALESCE(total_bytes_up, 0) + ?", req.BytesUpDelta)
	}
	if req.BytesDownDelta != 0 {
		updates["total_bytes_down"] = gorm.Expr("COALESCE(total_bytes_down, 0) + ?", req.BytesDownDelta)
	}
	if req.BytesUpDelta != 0 || req.BytesDownDelta != 0 {
		updates["usage_update_count"] = gorm.Expr("COALESCE(usage_update_count, 0) + 1")
	}
	switch record.LifecycleState {
	case models.SessionIntentAuthorized, models.SessionIntentRouted:
		applySessionIntentLifecycleTransition(&record, updates, models.SessionIntentActive, now)
	case models.SessionIntentActive:
		if record.ActivatedAt == nil {
			updates["activated_at"] = now
		}
	}

	if err := db.DB.Model(&record).Updates(updates).Error; err != nil {
		logging.Error(err).Str("intent_id", intentID.String()).Msg("Failed to update session intent usage")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update session intent usage"})
		return
	}

	if err := db.DB.Where("id = ?", intentID).First(&record).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reload session intent usage"})
		return
	}

	if req.BytesUpDelta != 0 || req.BytesDownDelta != 0 {
		unitPriceUSD, _ := resolveIntentUnitPrice(&record)
		nonce := uint64(record.UsageUpdateCount)
		if nonce == 0 {
			nonce = uint64(time.Now().UTC().UnixNano())
		}
		receipt, created, receiptErr := settlement.AppendIntentUsageReceipt(
			&record, req.BytesUpDelta, req.BytesDownDelta, nonce, unitPriceUSD,
		)
		if receiptErr != nil {
			logging.Error(receiptErr).Str("intent_id", intentID.String()).Msg("Failed to append intent usage receipt")
		} else if created && receipt != nil {
			go settlement.BestEffortPublishIntentReceipt(c.Request.Context(), receipt)
		}
	}

	c.JSON(http.StatusOK, buildSessionIntentStatusResponse(&record))
}

// requireGatewayAuth restricts gateway control-plane endpoints to trusted
// edge-gateway callers. Two schemes are accepted:
//
//  1. Timestamped HMAC (preferred, replay-resistant):
//     X-Gateway-Auth: hmac-v1
//     X-Gateway-Timestamp: unix seconds (±300s)
//     X-Gateway-Signature: HMAC-SHA256(secret, "v1:<ts>:<method>:<path>")
//  2. Static shared secret (legacy): X-Gateway-Auth == GATEWAY_SHARED_SECRET
//
// Multiple secrets can be rotated via GATEWAY_SHARED_SECRETS (comma-separated);
// any of them validates. Static mode is kept for backward compatibility and
// should be phased out once all edge-gateways send HMAC.
func requireGatewayAuth(_ *config.Config) gin.HandlerFunc {
	secrets := gatewaySecrets()

	return func(c *gin.Context) {
		if len(secrets) == 0 {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "Gateway authentication is not configured"})
			return
		}

		provided := strings.TrimSpace(c.GetHeader("X-Gateway-Auth"))

		// Scheme 1: timestamped HMAC
		if strings.EqualFold(provided, "hmac-v1") {
			if validGatewayHMAC(c, secrets) {
				c.Next()
				return
			}
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid gateway HMAC"})
			return
		}

		// Scheme 2: static shared secret (legacy)
		for _, s := range secrets {
			if subtle.ConstantTimeCompare([]byte(provided), []byte(s)) == 1 {
				c.Next()
				return
			}
		}
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized gateway request"})
	}
}

// gatewaySecrets returns the active gateway auth secrets, supporting rotation.
func gatewaySecrets() []string {
	seen := map[string]struct{}{}
	var out []string
	add := func(raw string) {
		for _, p := range strings.Split(raw, ",") {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			if _, ok := seen[p]; ok {
				continue
			}
			seen[p] = struct{}{}
			out = append(out, p)
		}
	}
	add(os.Getenv("GATEWAY_SHARED_SECRET"))
	add(os.Getenv("GATEWAY_SHARED_SECRETS"))
	return out
}

const gatewayHMACSkew = 300 // ±5 minutes

func validGatewayHMAC(c *gin.Context, secrets []string) bool {
	ts := strings.TrimSpace(c.GetHeader("X-Gateway-Timestamp"))
	sig := strings.TrimSpace(c.GetHeader("X-Gateway-Signature"))
	if ts == "" || sig == "" {
		return false
	}
	tsInt, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return false
	}
	now := time.Now().Unix()
	if tsInt < now-gatewayHMACSkew || tsInt > now+gatewayHMACSkew {
		return false
	}
	msg := fmt.Sprintf("v1:%s:%s:%s", ts, c.Request.Method, c.Request.URL.Path)
	sigBytes, err := hex.DecodeString(sig)
	if err != nil {
		return false
	}
	for _, s := range secrets {
		mac := hmac.New(sha256.New, []byte(s))
		mac.Write([]byte(msg))
		if hmac.Equal(mac.Sum(nil), sigBytes) {
			return true
		}
	}
	return false
}

// RegisterGatewayNodeRequest represents a node registration from the Edge Gateway
type RegisterGatewayNodeRequest struct {
	ProviderUserID string `json:"provider_user_id" binding:"required"`
	NodeID         string `json:"node_id" binding:"required"` // The node ID from Edge Gateway (e.g., "node_<user_id>")
	IPAddress      string `json:"ip_address" binding:"required"`
	Port           int    `json:"port"`
	Region         string `json:"region"`
	CountryCode    string `json:"country_code"`
	City           string `json:"city"`
	ISP            string `json:"isp"`
	ConnectionType string `json:"connection_type"` // residential, mobile, datacenter
	Version        string `json:"version"`
}

// registerGatewayNode creates or updates a node record when a provider connects via Edge Gateway
func registerGatewayNode(c *gin.Context) {
	var req RegisterGatewayNodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	req.IPAddress, req.CountryCode, req.City = normalizeGatewayGeo(req.IPAddress, req.CountryCode, req.City)

	// GW-04: resolve the authoritative ISP server-side when the registration
	// carries no real ISP name (the edge gateway historically sent the raw IP
	// in this field and cannot GeoIP-resolve it itself).
	if req.ISP == "" || net.ParseIP(req.ISP) != nil {
		if effectiveIP := geoip.ProviderIPForStorage(req.IPAddress); effectiveIP != "" {
			if result, ok := geoip.Resolve(effectiveIP); ok && result.ISP != "" && !geoip.IsCloudHostedISP(result.ISP) {
				req.ISP = result.ISP
			}
		}
	}

	// Parse provider user ID
	providerID, err := uuid.Parse(req.ProviderUserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid provider_user_id"})
		return
	}

	canonicalNode, canonicalCreated, err := upsertProviderNodeFromGateway(providerID, req)
	if err != nil {
		logging.Error(err).Str("gateway_node_id", req.NodeID).Msg("Failed to upsert canonical provider node")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upsert provider node"})
		return
	}

	// HB-04: publish auto-draft listing when the edge tunnel registers, if signed
	// heartbeat proofs are not required. Enforce mode still waits for a verified
	// Control API heartbeat (activateProviderListingDraftIfReady is a no-op until then).
	activateProviderListingDraftIfReady(providerID, canonicalNode.ID, !providerProofRequired())

	// Check if node already exists — prefer GatewayNodeID (stable across IP changes),
	// fall back to provider+IP+port for legacy registrations without a NodeID.
	var existingNode models.Node
	if req.NodeID != "" {
		err = db.DB.Where("provider_user_id = ? AND gateway_node_id = ?", providerID, req.NodeID).First(&existingNode).Error
	}
	if err != nil && req.NodeID == "" {
		// Legacy path: match on provider + IP + port
		err = db.DB.Where("provider_user_id = ? AND ip_address = ? AND port = ?", providerID, req.IPAddress, req.Port).First(&existingNode).Error
	}

	if err != nil {
		createIP := geoip.ProviderIPForStorage(req.IPAddress)
		createCountry, createCity, createRegion, createISP := req.CountryCode, req.City, req.Region, req.ISP
		if geoip.IsUntrustedGatewayGeo(req.IPAddress, req.ISP) {
			createIP = ""
			createCountry, createCity, createRegion, createISP = "", "", "", ""
		} else if geoip.IsCloudHostedISP(createISP) {
			createISP = ""
		}
		if canonicalNode.LocationUserSet {
			createCountry, createCity, createRegion = canonicalNode.Country, canonicalNode.City, canonicalNode.Region
		}
		node := models.Node{
			ID:                  uuid.New(),
			UserID:              providerID,
			ProviderUserID:      providerID,
			GatewayNodeID:       req.NodeID,
			IPAddress:           createIP,
			Port:                req.Port,
			Protocol:            "http",
			CountryCode:         createCountry,
			Region:              createRegion,
			City:                createCity,
			ISP:                 createISP,
			ConnectionType:      req.ConnectionType,
			IsHealthy:           true,
			ActiveConnections:   0,
			MaxConnections:      100,
			QualityScore:        100,
			UptimePercent:       100,
			LastSeenAt:          time.Now(),
			IsRegisteredOnChain: false,
			ProviderNodeID:      &canonicalNode.ID,
		}

		if err := db.DB.Create(&node).Error; err != nil {
			logging.Error(err).Str("node_id", req.NodeID).Msg("Failed to create gateway node")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create node"})
			return
		}

		scheduleNodeGeoEnrich(canonicalNode.ID.String())

		reconcileProviderNodeRegistry(providerID, canonicalNode.ID, req.NodeID, 0)

		logging.Info().
			Str("node_id", canonicalNode.ID.String()).
			Str("gateway_row_id", node.ID.String()).
			Str("provider_id", providerID.String()).
			Str("gateway_node_id", req.NodeID).
			Msg("Gateway node registered")

		c.JSON(http.StatusCreated, gin.H{
			"id":                canonicalNode.ID.String(),
			"node_id":           req.NodeID,
			"status":            "created",
			"is_healthy":        true,
			"quality_score":     canonicalNode.QualityScore,
			"current_tier":      canonicalNode.Tier,
			"base_price_per_gb": canonicalNode.BasePricePerGB,
			"isp":               req.ISP,
		})
	} else {
		// Update existing node
		updates := map[string]interface{}{
			"is_healthy":      true,
			"last_seen_at":    time.Now(),
			"connection_type": req.ConnectionType,
		}
		// Never let control-plane / cloud MaxMind (Chicago) overwrite a good pin.
		if !geoip.IsUntrustedGatewayGeo(req.IPAddress, req.ISP) {
			if canonicalNode.LocationUserSet {
				updates["region"] = canonicalNode.Region
				updates["country_code"] = canonicalNode.Country
				updates["city"] = canonicalNode.City
			} else {
				updates["region"] = req.Region
				updates["country_code"] = req.CountryCode
				updates["city"] = req.City
			}
			if strings.TrimSpace(req.ISP) != "" && !geoip.IsCloudHostedISP(req.ISP) {
				updates["isp"] = req.ISP
			}
			if stored := geoip.ProviderIPForStorage(req.IPAddress); stored != "" {
				updates["ip_address"] = stored
			}
		}
		if req.Port > 0 {
			updates["port"] = req.Port
		}
		if req.NodeID != "" {
			updates["gateway_node_id"] = req.NodeID
		}
		updates["provider_node_id"] = canonicalNode.ID

		if err := db.DB.Model(&existingNode).Updates(updates).Error; err != nil {
			logging.Error(err).Str("node_id", existingNode.ID.String()).Msg("Failed to update gateway node")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update node"})
			return
		}

		scheduleNodeGeoEnrich(canonicalNode.ID.String())

		reconcileProviderNodeRegistry(providerID, canonicalNode.ID, req.NodeID, 0)

		logging.Info().
			Str("node_id", canonicalNode.ID.String()).
			Str("gateway_row_id", existingNode.ID.String()).
			Str("gateway_node_id", req.NodeID).
			Msg("Gateway node reconnected")

		status := "updated"
		if canonicalCreated {
			status = "created"
		}
		c.JSON(http.StatusOK, gin.H{
			"id":                canonicalNode.ID.String(),
			"node_id":           req.NodeID,
			"status":            status,
			"is_healthy":        true,
			"quality_score":     canonicalNode.QualityScore,
			"current_tier":      canonicalNode.Tier,
			"base_price_per_gb": canonicalNode.BasePricePerGB,
			"isp":               req.ISP,
		})
	}
}

func upsertProviderNodeFromGateway(providerID uuid.UUID, req RegisterGatewayNodeRequest) (*models.ProviderNode, bool, error) {
	now := time.Now().UTC()
	node := resolveProviderNodeForGateway(providerID, req.NodeID)
	created := false
	if node == nil {
		name := req.NodeID
		if name == "" {
			name = "Gateway Node"
		}
		node = &models.ProviderNode{
			ID:            uuid.New(),
			UserID:        providerID,
			Name:          name,
			GatewayNodeID: req.NodeID,
			CreatedAt:     now,
		}
		created = true
	}

	updates := map[string]interface{}{
		"gateway_node_id":    req.NodeID,
		"connection_type":    req.ConnectionType,
		"protocol":           "http",
		"status":             models.NodeOnline,
		"is_healthy":         true,
		"active_connections": 0,
		"max_connections":    100,
		"quality_score":      100,
		"uptime_percent":     100,
		"last_seen_at":       now,
		"updated_at":         now,
	}
	// Only overwrite IP when the gateway reports a real public address that is
	// NOT this host's WAN / cloud egress. Private peers, control-plane WAN, and
	// Google Cloud MaxMind must not wipe a corrected residential location
	// (Ghana Bibiani, etc.).
	untrustedGeo := geoip.IsUntrustedGatewayGeo(req.IPAddress, req.ISP)
	storedIP := geoip.ProviderIPForStorage(req.IPAddress)
	if storedIP != "" && !untrustedGeo {
		updates["ip_address"] = storedIP
	} else if untrustedGeo && !created {
		// Explicitly clear a previously persisted control-plane/cloud WAN.
		if geoip.IsControlPlanePublicIP(node.IPAddress) || geoip.IsCloudHostedISP(node.ISP) {
			updates["ip_address"] = nil
			updates["isp"] = nil
		}
	}
	// Do not blank out a corrected country/city with empty gateway MaxMind fields.
	// Also ignore US/cloud labels derived from the control-plane / cloud WAN IP,
	// and never override a city the owner picked (IP geo often says Accra for Cape Coast).
	if !untrustedGeo && !node.LocationUserSet {
		if strings.TrimSpace(req.CountryCode) != "" {
			updates["country"] = req.CountryCode
		} else if created {
			updates["country"] = req.CountryCode
		}
		if strings.TrimSpace(req.City) != "" {
			updates["city"] = req.City
		} else if created {
			updates["city"] = req.City
		}
		if strings.TrimSpace(req.Region) != "" {
			updates["region"] = req.Region
		} else if created {
			updates["region"] = req.Region
		}
		if strings.TrimSpace(req.ISP) != "" && !geoip.IsCloudHostedISP(req.ISP) {
			updates["isp"] = req.ISP
		}
	}
	if req.Port > 0 {
		updates["port"] = req.Port
	}

	if created {
		if v, ok := updates["ip_address"].(string); ok {
			node.IPAddress = v
		}
		if v, ok := updates["country"].(string); ok {
			node.Country = v
		}
		if v, ok := updates["city"].(string); ok {
			node.City = v
		}
		if v, ok := updates["region"].(string); ok {
			node.Region = v
		}
		if v, ok := updates["isp"].(string); ok {
			node.ISP = v
		}
		node.ConnectionType = req.ConnectionType
		node.Protocol = "http"
		node.Status = models.NodeOnline
		node.IsHealthy = true
		node.ActiveConnections = 0
		node.MaxConnections = 100
		node.QualityScore = 100
		node.UptimePercent = 100
		node.LastSeenAt = &now
		node.UpdatedAt = now
		if req.Port > 0 {
			node.Port = req.Port
		}
		if err := db.DB.Create(node).Error; err != nil {
			return nil, false, err
		}
		return node, true, nil
	}

	if err := db.DB.Model(node).Updates(updates).Error; err != nil {
		return nil, false, err
	}
	if err := db.DB.Where("id = ?", node.ID).First(node).Error; err != nil {
		return nil, false, err
	}
	return node, false, nil
}

// GatewayHeartbeatRequest represents a heartbeat update from Edge Gateway
type GatewayHeartbeatRequest struct {
	ActiveConnections int   `json:"active_connections"`
	TotalBytesUp      int64 `json:"total_bytes_up"`
	TotalBytesDown    int64 `json:"total_bytes_down"`
	LatencyMs         int   `json:"latency_ms"`
	IsHealthy         bool  `json:"is_healthy"`
}

// updateGatewayNodeHeartbeat updates node stats from Edge Gateway heartbeat
func updateGatewayNodeHeartbeat(c *gin.Context) {
	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node ID"})
		return
	}

	var req GatewayHeartbeatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{
		"is_healthy":         req.IsHealthy,
		"active_connections": req.ActiveConnections,
		"latency_ms":         req.LatencyMs,
	}
	// An unhealthy report is not a sign of life: stamping last_seen_at here
	// would keep a dead node looking recently seen.
	if req.IsHealthy {
		updates["last_seen_at"] = time.Now()
	}

	if req.TotalBytesUp > 0 {
		updates["total_bytes_up"] = req.TotalBytesUp
	}
	if req.TotalBytesDown > 0 {
		updates["total_bytes_down"] = req.TotalBytesDown
	}

	providerUpdate := db.DB.Model(&models.ProviderNode{}).Where("id = ?", nodeID).Updates(updates)
	if providerUpdate.Error != nil {
		logging.Error(providerUpdate.Error).Str("node_id", nodeID.String()).Msg("Failed to update node heartbeat")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update heartbeat"})
		return
	}
	updatedProviderNode := providerUpdate.RowsAffected > 0
	qualityScore := 0.0
	currentTier := ""
	basePricePerGB := 0.0
	isp := ""
	explorerSyncID := nodeID.String()

	if !updatedProviderNode {
		if err := db.DB.Model(&models.Node{}).Where("id = ?", nodeID).Updates(updates).Error; err != nil {
			logging.Error(err).Str("node_id", nodeID.String()).Msg("Failed to update legacy node heartbeat")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update heartbeat"})
			return
		}
	}

	// Recalculate quality score using latest stats
	var node models.ProviderNode
	if updatedProviderNode {
		if err := db.DB.Where("id = ?", nodeID).First(&node).Error; err == nil {
			newScore := node.CalculateQualityScore()
			if err := db.DB.Model(&node).Update("quality_score", newScore).Error; err != nil {
				logging.Warn().Str("node_id", nodeID.String()).Err(err).Msg("Failed to update quality score on heartbeat")
			}
			// Reconciling marks the node online and stamps last_seen_at, so it
			// only follows a healthy report.
			if req.IsHealthy {
				reconcileProviderNodeRegistry(node.UserID, node.ID, node.GatewayNodeID, req.LatencyMs)
			}
			qualityScore = newScore
			currentTier = node.Tier
			basePricePerGB = node.BasePricePerGB
			isp = node.ISP
		}
	} else {
		var legacyNode models.Node
		if err := db.DB.Where("id = ?", nodeID).First(&legacyNode).Error; err == nil {
			newScore := legacyNode.CalculateQualityScore()
			if err := db.DB.Model(&legacyNode).Update("quality_score", newScore).Error; err != nil {
				logging.Warn().Str("node_id", nodeID.String()).Err(err).Msg("Failed to update quality score on legacy heartbeat")
			}
			isp = legacyNode.ISP
			if legacyNode.ProviderUserID != uuid.Nil && legacyNode.GatewayNodeID != "" {
				if pn := resolveProviderNodeForGateway(legacyNode.ProviderUserID, legacyNode.GatewayNodeID); pn != nil {
					if req.IsHealthy {
						reconcileProviderNodeRegistry(legacyNode.ProviderUserID, pn.ID, legacyNode.GatewayNodeID, req.LatencyMs)
					}
					node = *pn
					explorerSyncID = pn.ID.String()
					qualityScore = node.QualityScore
					currentTier = node.Tier
					basePricePerGB = node.BasePricePerGB
				} else if req.IsHealthy {
					syncProviderNodeFromGateway(legacyNode.ProviderUserID, legacyNode.GatewayNodeID, req.LatencyMs)
				}
			}
			if qualityScore == 0 {
				qualityScore = newScore
				currentTier = legacyNode.CurrentTier
				basePricePerGB = legacyNode.BasePricePerGB
			}
			if explorerSyncID == nodeID.String() {
				if legacyNode.ProviderNodeID != nil && *legacyNode.ProviderNodeID != uuid.Nil {
					explorerSyncID = legacyNode.ProviderNodeID.String()
				} else if pn := resolveProviderNodeForGateway(legacyNode.ProviderUserID, legacyNode.GatewayNodeID); pn != nil {
					explorerSyncID = pn.ID.String()
				}
			}
		}
	}

	// Trigger immediate sync to update explorer with latest heartbeat data
	go func(syncID string) {
		if ns := indexer.GetNodeSync(); ns != nil {
			if err := ns.SyncNodeNow(syncID); err != nil {
				logging.Debug().Err(err).Str("node_id", syncID).Msg("Heartbeat node sync skipped")
			}
		}
	}(explorerSyncID)

	c.JSON(http.StatusOK, gin.H{
		"status":            "ok",
		"timestamp":         time.Now(),
		"quality_score":     qualityScore,
		"current_tier":      currentTier,
		"base_price_per_gb": basePricePerGB,
		"isp":               isp,
	})
}

// GatewayStatusUpdateRequest represents a status update from Edge Gateway
type GatewayStatusUpdateRequest struct {
	IsHealthy bool   `json:"is_healthy"`
	Status    string `json:"status"` // "online", "offline", "degraded"
	Reason    string `json:"reason,omitempty"`
}

// gatewayStatusUpdates turns an edge status report into column updates.
// An offline or unhealthy report marks the node offline and leaves last_seen_at
// alone: the report is not a heartbeat, and stamping it would restart the
// stale clock at the moment the node went down, so the node kept showing as
// online for minutes. A healthy report counts as a sign of life.
func gatewayStatusUpdates(req GatewayStatusUpdateRequest, now time.Time) map[string]interface{} {
	updates := map[string]interface{}{"is_healthy": req.IsHealthy}
	if !req.IsHealthy || strings.EqualFold(strings.TrimSpace(req.Status), "offline") {
		updates["is_healthy"] = false
		updates["status"] = models.NodeOffline
		return updates
	}
	updates["last_seen_at"] = now
	return updates
}

// updateGatewayNodeStatus updates node online/offline status
func updateGatewayNodeStatus(c *gin.Context) {
	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node ID"})
		return
	}

	var req GatewayStatusUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := gatewayStatusUpdates(req, time.Now())

	result := db.DB.Model(&models.ProviderNode{}).Where("id = ?", nodeID).Updates(updates)
	if result.Error != nil {
		logging.Error(result.Error).Str("node_id", nodeID.String()).Msg("Failed to update node status")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update status"})
		return
	}
	if result.RowsAffected == 0 {
		// The legacy table has no status column to write; keep to health and
		// last-seen, as before.
		legacy := map[string]interface{}{"is_healthy": req.IsHealthy}
		if _, stamped := updates["last_seen_at"]; stamped {
			legacy["last_seen_at"] = updates["last_seen_at"]
		}
		if err := db.DB.Model(&models.Node{}).Where("id = ?", nodeID).Updates(legacy).Error; err != nil {
			logging.Error(err).Str("node_id", nodeID.String()).Msg("Failed to update legacy node status")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update status"})
			return
		}
	}

	// Trigger immediate sync to update explorer with status change
	go func(nodeID string) {
		if ns := indexer.GetNodeSync(); ns != nil {
			if err := ns.SyncNodeNow(nodeID); err != nil {
				logging.Debug().Err(err).Str("node_id", nodeID).Msg("Status update node sync skipped")
			}
		}
	}(nodeID.String())

	logging.Info().
		Str("node_id", nodeID.String()).
		Bool("is_healthy", req.IsHealthy).
		Str("status", req.Status).
		Msg("Gateway node status updated")

	c.JSON(http.StatusOK, gin.H{
		"status":     "ok",
		"is_healthy": req.IsHealthy,
		"timestamp":  time.Now(),
	})
}

// GetNodeByProviderAndIP looks up a node by provider ID and IP+port (used by gateway)
func GetNodeByProviderAndIP(providerID uuid.UUID, ipAddress string, port int) (*models.Node, error) {
	var node models.Node
	err := db.DB.Where("provider_user_id = ? AND ip_address = ? AND port = ?", providerID, ipAddress, port).First(&node).Error
	if err != nil {
		return nil, err
	}
	return &node, nil
}
