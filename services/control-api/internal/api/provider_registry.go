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
		if err := db.DB.Where("user_id = ? AND gateway_node_id = ?", providerUserID, gatewayNodeID).
			Order("created_at DESC").
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

// syncProviderNodeFromGateway marks dashboard provider_nodes online when the gateway sees activity.
func syncProviderNodeFromGateway(providerUserID uuid.UUID, gatewayNodeID string, latencyMs int) {
	if providerUserID == uuid.Nil {
		return
	}

	now := time.Now()
	updates := map[string]interface{}{
		"last_seen_at": now,
		"status":       models.NodeOnline,
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
