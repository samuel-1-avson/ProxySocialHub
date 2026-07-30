package api

import (
	"strings"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// ensureNodePayoutWallet copies the linked profile wallet onto the provider node
// when the node has no payout wallet yet. Safe to call repeatedly.
func ensureNodePayoutWallet(nodeID, userID uuid.UUID) {
	if db.DB == nil || nodeID == uuid.Nil || userID == uuid.Nil {
		return
	}

	var current string
	if err := db.DB.Model(&models.ProviderNode{}).
		Where("id = ? AND user_id = ?", nodeID, userID).
		Select("wallet_address").
		Scan(&current).Error; err != nil {
		return
	}
	if strings.TrimSpace(current) != "" {
		return
	}

	var profileWallet *string
	if err := db.DB.Model(&models.User{}).
		Where("id = ?", userID).
		Select("wallet_address").
		Scan(&profileWallet).Error; err != nil || profileWallet == nil {
		return
	}
	wallet := strings.TrimSpace(*profileWallet)
	if wallet == "" {
		return
	}

	_ = db.DB.Model(&models.ProviderNode{}).
		Where("id = ? AND user_id = ? AND (wallet_address = '' OR wallet_address IS NULL)", nodeID, userID).
		Update("wallet_address", wallet).Error
}

// ensureUserNodesPayoutWallets backfills payout wallets for all of a user's nodes
// that are still missing one (e.g. created before this binding existed).
func ensureUserNodesPayoutWallets(userID uuid.UUID) {
	if db.DB == nil || userID == uuid.Nil {
		return
	}
	var ids []uuid.UUID
	db.DB.Model(&models.ProviderNode{}).
		Where("user_id = ? AND deleted_at IS NULL AND (wallet_address = '' OR wallet_address IS NULL)", userID).
		Pluck("id", &ids)
	for _, id := range ids {
		ensureNodePayoutWallet(id, userID)
	}
}
