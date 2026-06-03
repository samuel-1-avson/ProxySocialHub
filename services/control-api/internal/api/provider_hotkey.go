package api

import (
	"context"
	"strings"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
)

// maybeBindProviderHotkey sets provider_nodes.hotkey from a verified proof signer when the
// node has no hotkey yet, or leaves it unchanged when it already matches.
// If the user profile has wallet_address set, the signer must match it.
func maybeBindProviderHotkey(nodeID, userID uuid.UUID, signer string, verified bool) bool {
	signer = strings.TrimSpace(signer)
	if !verified || signer == "" {
		return false
	}

	var node models.ProviderNode
	if err := db.DB.Select("id", "hotkey", "ip_address", "country").
		Where("id = ? AND user_id = ?", nodeID, userID).
		First(&node).Error; err != nil {
		return false
	}

	existing := strings.TrimSpace(node.Hotkey)
	if existing != "" {
		return existing == signer
	}

	if wallet := profileWalletAddress(userID); wallet != "" && wallet != signer {
		logging.Warn().
			Str("node_id", nodeID.String()).
			Str("signer", signer).
			Str("wallet", wallet).
			Msg("maybeBindProviderHotkey: proof signer does not match profile wallet")
		return false
	}

	if _, err := sol.PublicKeyFromBase58(signer); err != nil {
		logging.Warn().Str("signer", signer).Msg("maybeBindProviderHotkey: invalid signer pubkey")
		return false
	}

	if err := db.DB.Model(&models.ProviderNode{}).
		Where("id = ? AND user_id = ? AND (hotkey IS NULL OR hotkey = '')", nodeID, userID).
		Update("hotkey", signer).Error; err != nil {
		logging.Warn().Err(err).Str("node_id", nodeID.String()).Msg("maybeBindProviderHotkey: update failed")
		return false
	}

	logging.Info().
		Str("node_id", nodeID.String()).
		Str("hotkey", signer).
		Msg("maybeBindProviderHotkey: bound provider hotkey from verified proof")

	go registerProviderOnChainAsync(nodeID, signer, node.IPAddress, node.Country)
	return true
}

func profileWalletAddress(userID uuid.UUID) string {
	var wallet *string
	if err := db.DB.Model(&models.User{}).
		Where("id = ?", userID).
		Select("wallet_address").
		Scan(&wallet).Error; err != nil || wallet == nil {
		return ""
	}
	return strings.TrimSpace(*wallet)
}

func registerProviderOnChainAsync(nodeID uuid.UUID, hotkey, ip, country string) {
	oracle := solanaClient.GetOracleClient()
	if oracle == nil {
		return
	}
	providerPubkey, err := sol.PublicKeyFromBase58(hotkey)
	if err != nil {
		return
	}
	endpoint := strings.TrimSpace(ip)
	if endpoint == "" {
		endpoint = "unknown"
	}
	sig, err := oracle.RegisterProviderOnChain(context.Background(), solanaClient.RegisterProviderParams{
		Provider: providerPubkey,
		Endpoint: endpoint,
		Location: country,
	})
	if err != nil {
		logging.Warn().Err(err).Str("node_id", nodeID.String()).Msg("registerProviderOnChainAsync: failed (non-fatal)")
		return
	}
	db.DB.Model(&models.ProviderNode{}).Where("id = ?", nodeID).Updates(map[string]interface{}{
		"is_registered_on_chain": true,
	})
	logging.Info().Str("sig", sig).Str("node_id", nodeID.String()).Msg("registerProviderOnChainAsync: provider registered on-chain")
}
