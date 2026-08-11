package api

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

// providerGatewayNodeID is the stable gateway tunnel identity for a provider user.
func providerGatewayNodeID(userID uuid.UUID) string {
	return fmt.Sprintf("node_%s", userID.String())
}

// resolveProviderNodeForGateway finds the dashboard node row for a gateway connection.
func resolveProviderNodeForGateway(providerUserID uuid.UUID, gatewayNodeID string) *models.ProviderNode {
	if providerUserID == uuid.Nil {
		return nil
	}

	var node models.ProviderNode

	if gatewayNodeID != "" {
		// Prefer the node that is currently online / recently heartbeating for this
		// gateway identity. Ordering only by created_at incorrectly binds tunnels to
		// a newer sibling row that shares the same gateway_node_id.
		if err := db.DB.Where("user_id = ? AND gateway_node_id = ?", providerUserID, gatewayNodeID).
			Order("CASE WHEN status = 'online' THEN 0 ELSE 1 END, last_seen_at DESC NULLS LAST, created_at DESC").
			First(&node).Error; err == nil {
			return &node
		}
	}

	// Prefer a node without a gateway id yet (created via dashboard/API before first tunnel).
	if err := db.DB.Where("user_id = ? AND (gateway_node_id IS NULL OR gateway_node_id = '')", providerUserID).
		Order("created_at DESC").
		First(&node).Error; err == nil {
		return &node
	}

	if err := db.DB.Where("user_id = ?", providerUserID).
		Order("created_at DESC").
		First(&node).Error; err == nil {
		return &node
	}

	return nil
}

func linkProviderNodeGatewayIdentity(providerNodeID uuid.UUID, gatewayNodeID string) {
	if providerNodeID == uuid.Nil || gatewayNodeID == "" {
		return
	}
	if err := db.DB.Model(&models.ProviderNode{}).
		Where("id = ? AND (gateway_node_id IS NULL OR gateway_node_id = '')", providerNodeID).
		Update("gateway_node_id", gatewayNodeID).Error; err != nil {
		logging.Debug().Err(err).Str("provider_node_id", providerNodeID.String()).Msg("linkProviderNodeGatewayIdentity skipped")
	}
}

func linkGatewayNodeToProviderNode(gatewayRowID uuid.UUID, providerNode *models.ProviderNode, gatewayNodeID string) {
	if providerNode == nil || gatewayRowID == uuid.Nil {
		return
	}

	linkProviderNodeGatewayIdentity(providerNode.ID, gatewayNodeID)

	if err := db.DB.Model(&models.Node{}).
		Where("id = ?", gatewayRowID).
		Update("provider_node_id", providerNode.ID).Error; err != nil {
		logging.Debug().Err(err).
			Str("gateway_row_id", gatewayRowID.String()).
			Str("provider_node_id", providerNode.ID.String()).
			Msg("linkGatewayNodeToProviderNode failed")
	}
}

// reconcileProviderNodeRegistry keeps provider_nodes, nodes, and gateway identity aligned.
func reconcileProviderNodeRegistry(providerUserID, providerNodeID uuid.UUID, gatewayNodeID string, latencyMs int) {
	if providerUserID == uuid.Nil || providerNodeID == uuid.Nil {
		return
	}
	if gatewayNodeID == "" {
		gatewayNodeID = providerGatewayNodeID(providerUserID)
		_ = db.DB.Model(&models.ProviderNode{}).
			Where("id = ? AND user_id = ?", providerNodeID, providerUserID).
			Update("gateway_node_id", gatewayNodeID).Error
	}
	linkProviderNodeGatewayIdentity(providerNodeID, gatewayNodeID)
	syncProviderNodeFromGateway(providerUserID, gatewayNodeID, latencyMs)

	var gatewayRow models.Node
	switch err := db.DB.Where("provider_user_id = ? AND gateway_node_id = ?", providerUserID, gatewayNodeID).
		Order("created_at DESC").
		First(&gatewayRow).Error; err {
	case nil:
		// linked below
	default:
		if err := db.DB.Where("provider_user_id = ?", providerUserID).
			Order("created_at DESC").
			First(&gatewayRow).Error; err != nil {
			return
		}
	}
	linkGatewayNodeToProviderNode(gatewayRow.ID, &models.ProviderNode{ID: providerNodeID}, gatewayNodeID)
}

// syncProviderNodeFromGateway marks dashboard provider_nodes online when the gateway sees activity.
func syncProviderNodeFromGateway(providerUserID uuid.UUID, gatewayNodeID string, latencyMs int) {
	if providerUserID == uuid.Nil {
		return
	}

	now := time.Now()
	updates := map[string]interface{}{
		"last_seen_at": now,
		"status":       models.NodeOnline,
		"is_healthy":   true,
	}
	if latencyMs > 0 {
		updates["avg_latency_ms"] = latencyMs
	}

	q := db.DB.Model(&models.ProviderNode{}).Where("user_id = ?", providerUserID)
	if gatewayNodeID != "" {
		if pn := resolveProviderNodeForGateway(providerUserID, gatewayNodeID); pn != nil {
			q = db.DB.Model(&models.ProviderNode{}).Where("id = ?", pn.ID)
			if pn.GatewayNodeID == "" {
				updates["gateway_node_id"] = gatewayNodeID
			}
		} else {
			q = q.Where("gateway_node_id = ?", gatewayNodeID)
		}
	}

	if err := q.Updates(updates).Error; err != nil {
		logging.Debug().Err(err).Str("user_id", providerUserID.String()).Msg("syncProviderNodeFromGateway skipped")
	}
}
