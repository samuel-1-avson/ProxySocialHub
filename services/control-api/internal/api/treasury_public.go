package api

import (
	"context"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/treasury"
	"github.com/proxyhubb/control-api/internal/worker"
)

// RegisterTreasuryPublicRoutes exposes read-only treasury transparency (no auth).
func RegisterTreasuryPublicRoutes(r *gin.RouterGroup) {
	r.GET("/treasury/public", getPublicTreasury)
}

type publicBatchPayout struct {
	ID           string  `json:"id"`
	Status       string  `json:"status"`
	TotalAmount  float64 `json:"total_amount"`
	TotalCount   int     `json:"total_count"`
	SuccessCount int     `json:"success_count"`
	TxHash       string  `json:"tx_hash,omitempty"`
	SolscanURL   string  `json:"solscan_url,omitempty"`
	ProcessedAt  string  `json:"processed_at,omitempty"`
}

type publicTreasuryResponse struct {
	Network              string              `json:"network"`
	SolPriceUSD          float64             `json:"sol_price_usd"`
	OracleConfigured     bool                `json:"oracle_configured"`
	Treasury             *treasury.TreasuryStats `json:"treasury,omitempty"`
	LifetimePaidSOL      float64             `json:"lifetime_provider_paid_sol"`
	RecentBatchPayouts   []publicBatchPayout `json:"recent_batch_payouts"`
	OperationalHealthy   bool                `json:"operational_healthy"`
	Timestamp            time.Time           `json:"timestamp"`
}

func getPublicTreasury(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 12*time.Second)
	defer cancel()

	resp := publicTreasuryResponse{
		Network:          solanaNetworkLabel(),
		SolPriceUSD:      billing.GetSOLPriceUSD(),
		OracleConfigured: solana.IsOracleConfigured(),
		Timestamp:        time.Now().UTC(),
	}

	tm := treasury.GetManager()
	if stats, err := tm.GetTreasuryStats(ctx); err == nil {
		depth, oldestAge := worker.QueueDepthStats()
		stats.AttachQueueMetrics(depth, oldestAge)
		resp.Treasury = stats
		if stats.Status == "HEALTHY" || stats.Status == "BELOW_TARGET" {
			resp.OperationalHealthy = true
		}
		// Queue backlog or critical hot balance → not fully healthy.
		if depth > 0 && oldestAge > 300 {
			resp.OperationalHealthy = false
		}
	} else {
		// Still expose configured addresses when stats fail hard (misconfig).
		hot := treasury.GetHotTreasuryPubkey()
		if !hot.IsZero() {
			view := &treasury.TreasuryStats{
				Address: hot.String(),
				Hot: treasury.WalletBalanceView{
					Address:            hot.String(),
					BalanceUnavailable: true,
					MinBalanceSOL:      treasury.HotMinBalanceSOL(),
					MaxBalanceSOL:      treasury.HotMaxBalanceSOL(),
					ReplenishSOL:       treasury.HotReplenishAmountSOL(),
				},
				Status:        "RPC_UNAVAILABLE",
				LastCheckedAt: time.Now().UTC(),
			}
			if cold := treasury.GetColdTreasuryPubkey(); !cold.IsZero() {
				view.Cold = &treasury.WalletBalanceView{
					Address:            cold.String(),
					BalanceUnavailable: true,
				}
			}
			if vault := treasury.GetDepositVaultPubkey(); !vault.IsZero() {
				view.Vault = &treasury.WalletBalanceView{
					Address:            vault.String(),
					BalanceUnavailable: true,
				}
			}
			resp.Treasury = view
		}
	}

	var lifetimePaid float64
	db.DB.Model(&models.ProviderEarning{}).
		Where("status = ? AND deleted_at IS NULL", "paid").
		Select("COALESCE(SUM(net_amount_sol), 0)").
		Scan(&lifetimePaid)
	resp.LifetimePaidSOL = lifetimePaid

	var batches []models.BatchPayout
	db.DB.Where("status IN ?", []string{string(models.BatchStatusCompleted), string(models.BatchStatusPartial)}).
		Order("created_at DESC").
		Limit(15).
		Find(&batches)

	for _, b := range batches {
		item := publicBatchPayout{
			ID:           b.ID.String(),
			Status:       string(b.Status),
			TotalAmount:  b.TotalAmount,
			TotalCount:   b.TotalCount,
			SuccessCount: b.SuccessCount,
		}
		if b.TxHash != nil && *b.TxHash != "" {
			item.TxHash = *b.TxHash
			item.SolscanURL = SolscanTxURL(*b.TxHash)
		}
		if b.ProcessedAt != nil {
			item.ProcessedAt = b.ProcessedAt.UTC().Format(time.RFC3339)
		}
		resp.RecentBatchPayouts = append(resp.RecentBatchPayouts, item)
	}

	c.JSON(http.StatusOK, resp)
}

func solanaNetworkLabel() string {
	n := os.Getenv("SOLANA_NETWORK")
	if n == "" {
		return "devnet"
	}
	return n
}
