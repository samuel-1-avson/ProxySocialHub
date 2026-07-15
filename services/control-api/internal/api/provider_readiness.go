package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

type providerReadinessResponse struct {
	Status  string                        `json:"status"`
	Summary providerReadinessSummary      `json:"summary"`
	Checks  []providerReadinessCheck      `json:"checks"`
	Next    *providerReadinessRecommended `json:"next,omitempty"`
}

type providerReadinessSummary struct {
	ActiveTokens        int64      `json:"active_tokens"`
	Nodes               int64      `json:"nodes"`
	OnlineNodes         int64      `json:"online_nodes"`
	ProofVerifiedNodes  int64      `json:"proof_verified_nodes"`
	PayoutWalletNodes   int64      `json:"payout_wallet_nodes"`
	ActiveListings      int64      `json:"active_listings"`
	LastHeartbeatAt     *time.Time `json:"last_heartbeat_at,omitempty"`
	ProofMode           string     `json:"proof_mode"`
	ReadyForTraffic     bool       `json:"ready_for_traffic"`
	ReadyForMarketplace bool       `json:"ready_for_marketplace"`
	ReadyForPayouts     bool       `json:"ready_for_payouts"`
}

type providerReadinessCheck struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Status      string `json:"status"`
	Blocking    bool   `json:"blocking"`
	Message     string `json:"message"`
	ActionLabel string `json:"action_label,omitempty"`
	ActionHref  string `json:"action_href,omitempty"`
}

type providerReadinessRecommended struct {
	CheckID     string `json:"check_id"`
	ActionLabel string `json:"action_label"`
	ActionHref  string `json:"action_href"`
	Message     string `json:"message"`
}

const (
	readinessComplete       = "complete"
	readinessActionRequired = "action_required"
	readinessAttention      = "attention"
	readinessReady          = "ready"
)

func getProviderReadiness(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	summary := collectProviderReadinessSummary(userID)
	checks := buildProviderReadinessChecks(summary)
	status := providerReadinessOverallStatus(checks)

	var next *providerReadinessRecommended
	for _, check := range checks {
		if check.Status == readinessComplete {
			continue
		}
		next = &providerReadinessRecommended{
			CheckID:     check.ID,
			ActionLabel: check.ActionLabel,
			ActionHref:  check.ActionHref,
			Message:     check.Message,
		}
		break
	}

	c.JSON(http.StatusOK, providerReadinessResponse{
		Status:  status,
		Summary: summary,
		Checks:  checks,
		Next:    next,
	})
}

func collectProviderReadinessSummary(userID uuid.UUID) providerReadinessSummary {
	now := time.Now()
	var summary providerReadinessSummary
	summary.ProofMode = providerProofMode()

	db.DB.Model(&models.ProviderToken{}).
		Where("user_id = ? AND is_active = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)", userID, true, now).
		Count(&summary.ActiveTokens)

	db.DB.Model(&models.ProviderNode{}).
		Where("user_id = ? AND deleted_at IS NULL", userID).
		Count(&summary.Nodes)

	db.DB.Model(&models.ProviderNode{}).
		Where("user_id = ? AND deleted_at IS NULL AND status = ?", userID, models.NodeOnline).
		Count(&summary.OnlineNodes)

	db.DB.Model(&models.ProviderNode{}).
		Where("user_id = ? AND deleted_at IS NULL AND latest_heartbeat_verified = ?", userID, true).
		Count(&summary.ProofVerifiedNodes)

	db.DB.Model(&models.ProviderNode{}).
		Where("user_id = ? AND deleted_at IS NULL AND wallet_address <> ''", userID).
		Count(&summary.PayoutWalletNodes)

	db.DB.Model(&models.ProxyListing{}).
		Where("seller_id = ? AND status = ?", userID, models.ListingStatusActive).
		Count(&summary.ActiveListings)

	var lastSeen time.Time
	if err := db.DB.Model(&models.ProviderNode{}).
		Where("user_id = ? AND deleted_at IS NULL AND last_seen_at IS NOT NULL", userID).
		Select("MAX(last_seen_at)").
		Scan(&lastSeen).Error; err == nil && !lastSeen.IsZero() {
		summary.LastHeartbeatAt = &lastSeen
	}

	summary.ReadyForTraffic = summary.ActiveTokens > 0 && summary.Nodes > 0 && summary.OnlineNodes > 0
	summary.ReadyForMarketplace = summary.ReadyForTraffic && summary.ActiveListings > 0
	summary.ReadyForPayouts = summary.PayoutWalletNodes > 0

	return summary
}

func buildProviderReadinessChecks(summary providerReadinessSummary) []providerReadinessCheck {
	proofBlocking := summary.ProofMode == "enforce"

	checks := []providerReadinessCheck{
		{
			ID:       "provider_account",
			Label:    "Provider account",
			Status:   readinessComplete,
			Blocking: true,
			Message:  "Provider workspace access is unlocked.",
		},
		boolReadinessCheck(
			"api_token",
			"API token",
			summary.ActiveTokens > 0,
			true,
			"Create a provider API token so the daemon can authenticate.",
			"Create token",
			"/dashboard/provider/tokens",
		),
		boolReadinessCheck(
			"provider_node",
			"Provider node",
			summary.Nodes > 0,
			true,
			"Register at least one provider node.",
			"Add node",
			"/dashboard/provider/setup",
		),
		boolReadinessCheck(
			"config_ready",
			"Ready-to-run config",
			summary.ActiveTokens > 0 && summary.Nodes > 0,
			true,
			"Generate or download provider.toml from the node connect panel.",
			"Download config",
			"/dashboard/provider/nodes",
		),
		boolReadinessCheck(
			"daemon_heartbeat",
			"Daemon heartbeat",
			summary.OnlineNodes > 0,
			true,
			"Start provider-node and wait for the first heartbeat.",
			"Open nodes",
			"/dashboard/provider/nodes",
		),
		boolReadinessCheck(
			"heartbeat_proof",
			"Heartbeat proof",
			summary.ProofVerifiedNodes > 0,
			proofBlocking,
			"Configure provider_signing_key so heartbeats can be verified.",
			"Open CLI setup",
			"/dashboard/provider/cli",
		),
		boolReadinessCheck(
			"payout_wallet",
			"Payout wallet",
			summary.PayoutWalletNodes > 0,
			false,
			"Link a Solana payout wallet on a provider node before claiming earnings.",
			"Open wallet",
			"/dashboard/wallet",
		),
		boolReadinessCheck(
			"marketplace_listing",
			"Marketplace listing",
			summary.ActiveListings > 0,
			true,
			"Publish or restore an active marketplace listing for your provider node.",
			"Manage listings",
			"/marketplace/manage",
		),
	}

	if !proofBlocking && checks[5].Status != readinessComplete {
		checks[5].Status = readinessAttention
	}
	if checks[6].Status != readinessComplete {
		checks[6].Status = readinessAttention
	}

	return checks
}

func boolReadinessCheck(id, label string, ok, blocking bool, message, actionLabel, actionHref string) providerReadinessCheck {
	status := readinessComplete
	if !ok {
		status = readinessAttention
		if blocking {
			status = readinessActionRequired
		}
	}
	if ok {
		message = label + " is configured."
		actionLabel = ""
		actionHref = ""
	}
	return providerReadinessCheck{
		ID:          id,
		Label:       label,
		Status:      status,
		Blocking:    blocking,
		Message:     message,
		ActionLabel: actionLabel,
		ActionHref:  actionHref,
	}
}

func providerReadinessOverallStatus(checks []providerReadinessCheck) string {
	hasAttention := false
	for _, check := range checks {
		if check.Status == readinessComplete {
			continue
		}
		if check.Blocking {
			return readinessActionRequired
		}
		hasAttention = true
	}
	if hasAttention {
		return readinessAttention
	}
	return readinessReady
}
