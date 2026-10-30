package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/models"
)

// edgePingResult is the edge-gateway reply from POST /internal/providers/:id/ping.
type edgePingResult struct {
	Reachable bool    `json:"reachable"`
	RTTMs     *int64  `json:"rtt_ms"`
	Reason    *string `json:"reason"`
	PodID     string  `json:"pod_id"`
}

var edgePingClient = &http.Client{Timeout: 6 * time.Second}

// probeEdgeNode asks the edge to send PING down the node's tunnel. A var so tests can stub it.
var probeEdgeNode = func(ctx context.Context, gatewayNodeID string) (edgePingResult, error) {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("EDGE_GATEWAY_MGMT_URL")), "/")
	if base == "" {
		base = "http://edge-gateway:8090"
	}
	endpoint := fmt.Sprintf("%s/internal/providers/%s/ping", base, url.PathEscape(gatewayNodeID))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, nil)
	if err != nil {
		return edgePingResult{}, err
	}
	req.Header.Set("X-Gateway-Auth", strings.TrimSpace(os.Getenv("GATEWAY_SHARED_SECRET")))

	resp, err := edgePingClient.Do(req)
	if err != nil {
		return edgePingResult{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return edgePingResult{}, fmt.Errorf("edge ping returned %d", resp.StatusCode)
	}
	var out edgePingResult
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return edgePingResult{}, err
	}
	return out, nil
}

func pingMessage(alive bool, rttMs int64, reason string) string {
	if alive {
		return fmt.Sprintf("Replied in %d ms", rttMs)
	}
	switch reason {
	case "not_connected":
		return "Not connected. Start the node on your PC."
	case "timeout":
		return "No reply in 4 s"
	case "gateway_unreachable":
		return "Couldn't reach the gateway. Try again."
	default:
		return "Node did not answer the ping"
	}
}

// pingProviderNode sends a real PING through the edge to the node and reports the reply.
// Read-only: it never changes status, last_seen_at or heartbeat proof fields.
// POST /v1/provider/nodes/:id/ping
func pingProviderNode(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node ID"})
		return
	}

	var node models.ProviderNode
	if err := db.DB.Where("id = ? AND user_id = ?", nodeID, userID).First(&node).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
		return
	}

	result, err := probeEdgeNode(c.Request.Context(), marketplace.GatewayRoutingNodeID(&node))
	alive := false
	var rttMs int64
	reason := "gateway_unreachable"
	if err != nil {
		logging.Warn().Err(err).Str("node_id", nodeID.String()).Msg("pingProviderNode: edge probe failed")
	} else {
		alive = result.Reachable
		reason = ""
		if result.RTTMs != nil {
			rttMs = *result.RTTMs
		}
		if result.Reason != nil {
			reason = *result.Reason
		}
	}

	payload := gin.H{
		"alive":          alive,
		"message":        pingMessage(alive, rttMs, reason),
		"checked_at":     time.Now().UTC(),
		"node_status":    node.Status,
		"proof_verified": node.LatestHeartbeatVerified,
	}
	if alive {
		payload["rtt_ms"] = rttMs
	} else {
		payload["reason"] = reason
	}
	c.JSON(http.StatusOK, payload)
}
