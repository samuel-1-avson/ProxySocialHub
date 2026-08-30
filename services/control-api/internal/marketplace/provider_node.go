package marketplace

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// ResolveListingProviderNode picks the provider_nodes row that should serve a listing purchase.
func ResolveListingProviderNode(listing *models.ProxyListing) (*models.ProviderNode, error) {
	if listing == nil {
		return nil, fmt.Errorf("listing is nil")
	}

	var node models.ProviderNode
	if listing.ProviderNodeID != nil && *listing.ProviderNodeID != uuid.Nil {
		err := db.DB.Where("id = ? AND user_id = ? AND deleted_at IS NULL", *listing.ProviderNodeID, listing.SellerID).
			First(&node).Error
		if err == nil {
			return &node, nil
		}
		// Pinned node may have been soft-deleted while the listing stayed active.
		// Fall through to another live node for this seller so escrow can activate.
	}

	err := db.DB.
		Where("user_id = ? AND is_healthy = true AND active_connections < max_connections AND deleted_at IS NULL", listing.SellerID).
		Order("quality_score DESC").
		First(&node).Error
	if err == nil {
		return &node, nil
	}

	err = db.DB.Where("user_id = ? AND deleted_at IS NULL", listing.SellerID).
		Order("CASE WHEN status = 'online' THEN 0 ELSE 1 END, quality_score DESC, last_seen_at DESC NULLS LAST").
		First(&node).Error
	if err != nil {
		return nil, fmt.Errorf("provider has no available nodes: %w", err)
	}
	return &node, nil
}

// ResolveProviderNodeForSession maps a session's node_id to the dashboard
// provider_nodes row. sessions.node_id stores the legacy nodes.id mirror, not
// provider_nodes.id — looking up provider_nodes by session.NodeID misses earnings.
func ResolveProviderNodeForSession(session models.Session) (*models.ProviderNode, error) {
	if session.NodeID == nil || *session.NodeID == uuid.Nil {
		return nil, fmt.Errorf("session has no node_id")
	}

	var pn models.ProviderNode
	if err := db.DB.First(&pn, "id = ? AND deleted_at IS NULL", *session.NodeID).Error; err == nil {
		return &pn, nil
	}

	var mirror models.Node
	if err := db.DB.First(&mirror, "id = ? AND deleted_at IS NULL", *session.NodeID).Error; err != nil {
		return nil, fmt.Errorf("session node not found: %w", err)
	}
	if mirror.ProviderNodeID == nil || *mirror.ProviderNodeID == uuid.Nil {
		return nil, fmt.Errorf("legacy node %s has no provider_node_id", mirror.ID)
	}
	if err := db.DB.First(&pn, "id = ? AND deleted_at IS NULL", *mirror.ProviderNodeID).Error; err != nil {
		return nil, fmt.Errorf("provider node %s not found: %w", mirror.ProviderNodeID, err)
	}
	return &pn, nil
}

// SessionNodeIDForProvider returns the sessions.node_id FK target (nodes.id) for a provider node.
// sessions.node_id references the legacy nodes mirror row, not provider_nodes.id.
func SessionNodeIDForProvider(providerNode *models.ProviderNode) *uuid.UUID {
	if providerNode == nil {
		return nil
	}
	var mirror models.Node
	err := db.DB.Where("provider_node_id = ? AND deleted_at IS NULL", providerNode.ID).First(&mirror).Error
	if err != nil {
		return nil
	}
	return &mirror.ID
}

// GatewayRoutingNodeID returns the edge-gateway registry id for a provider node tunnel.
func GatewayRoutingNodeID(node *models.ProviderNode) string {
	if node == nil {
		return ""
	}
	if id := strings.TrimSpace(node.GatewayNodeID); id != "" {
		return id
	}
	return fmt.Sprintf("node_%s", node.UserID.String())
}
