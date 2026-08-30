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
//
// The heartbeat/listing signer is the node device key (provider.toml). That is
// independent of the seller payout wallet (Phantom). ProviderRegistry PDAs are
// keyed by the device hotkey; escrow seller is the linked payout wallet.
func maybeBindProviderHotkey(nodeID, userID uuid.UUID, signer string, verified bool) bool {
	signer = strings.TrimSpace(signer)
	if !verified || signer == "" {
		return false
	}

	var node models.ProviderNode
	if err := db.DB.Select("id", "hotkey", "ip_address", "country", "is_registered_on_chain").
		Where("id = ? AND user_id = ?", nodeID, userID).
		First(&node).Error; err != nil {
		return false
	}

	existing := strings.TrimSpace(node.Hotkey)
	if existing != "" {
		if existing == signer && !node.IsRegisteredOnChain {
			go registerProviderOnChainAsync(nodeID, existing, node.IPAddress, node.Country)
		}
		return existing == signer
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
	defer func() {
		if rec := recover(); rec != nil {
			logging.Warn().Interface("panic", rec).Str("node_id", nodeID.String()).
				Msg("registerProviderOnChainAsync: recovered")
		}
	}()
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
	ctx := context.Background()
	sig, err := oracle.RegisterProviderOnChain(ctx, solanaClient.RegisterProviderParams{
		Provider: providerPubkey,
		Endpoint: endpoint,
		Location: country,
	})
	if err != nil {
		lower := strings.ToLower(err.Error())
		already := strings.Contains(lower, "already in use") || strings.Contains(lower, "alreadyinitialized")
		if !already {
			if existing, readErr := oracle.ReadProviderRegistry(ctx, providerPubkey); readErr == nil && existing != nil && existing.IsActive {
				already = true
			}
		}
		if !already {
			logging.Warn().Err(err).Str("node_id", nodeID.String()).Msg("registerProviderOnChainAsync: failed (non-fatal)")
			return
		}
		logging.Info().Err(err).Str("node_id", nodeID.String()).Msg("registerProviderOnChainAsync: registry already present")
	} else {
		logging.Info().Str("sig", sig).Str("node_id", nodeID.String()).Msg("registerProviderOnChainAsync: provider registered on-chain")
	}

	if _, hbErr := oracle.ProviderHeartbeatOnChain(ctx, solanaClient.ProviderHeartbeatParams{
		Provider:            providerPubkey,
		QualityScore:        100,
		BandwidthServedDelta: 0,
	}); hbErr != nil {
		logging.Warn().Err(hbErr).Str("node_id", nodeID.String()).Msg("registerProviderOnChainAsync: on-chain heartbeat failed (non-fatal)")
	}

	db.DB.Model(&models.ProviderNode{}).Where("id = ?", nodeID).Updates(map[string]interface{}{
		"is_registered_on_chain": true,
	})
}
