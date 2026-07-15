// Package solana - API handlers for Solana blockchain operations
package solana

import (
	"context"
	"fmt"
	"net/http"
	"os"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/decentralization"
)

// Global oracle client instance
var oracleClient *OracleClient

// InitOracleFromEnv initializes the oracle client from environment variables
func InitOracleFromEnv() error {
	rpcEndpoints := HealthyRPCEndpoints(context.Background(), RPCEndpointsFromEnv())

	keypairPath := os.Getenv("SOLANA_ORACLE_KEYPAIR")
	if keypairPath == "" {
		if decentralization.FullModeEnabled() {
			return fmt.Errorf("FULL_DECENTRALIZATION requires SOLANA_ORACLE_KEYPAIR to be configured")
		}
		// Skip initialization if no keypair configured
		fmt.Println("[Solana] Oracle keypair not configured, settlement disabled")
		return nil
	}

	network := os.Getenv("SOLANA_NETWORK")
	if network == "" {
		network = "devnet"
	}

	client, err := NewOracleClient(Config{
		RPCEndpoints:      rpcEndpoints,
		OracleKeypairPath: keypairPath,
		Network:           network,
	})
	if err != nil {
		return fmt.Errorf("failed to create oracle client: %w", err)
	}

	oracleClient = client
	globalOracleClient = client
	fmt.Printf("[Solana] Oracle initialized on %s: %s\n", network, client.GetOraclePublicKey().String())
	return nil
}

// IsOracleConfigured returns true if the oracle client is ready
func IsOracleConfigured() bool {
	return oracleClient != nil
}

// GetOracle returns the oracle client instance
func GetOracle() *OracleClient {
	return oracleClient
}

// RegisterPublicRoutes registers read-only Solana routes that do not require auth.
func RegisterPublicRoutes(r *gin.RouterGroup) {
	r.GET("/solana/health", healthHandler)
}

// RegisterRoutes registers Solana-related API routes (authenticated).
func RegisterRoutes(r *gin.RouterGroup) {
	solanaGroup := r.Group("/solana")
	{
		solanaGroup.GET("/escrow/:buyer/:seller", getEscrowHandler)
		solanaGroup.POST("/escrow/settle", settleEscrowHandler)
	}
}

// ErrorResponse represents an API error
type ErrorResponse struct {
	Error string `json:"error"`
}

// healthHandler returns the oracle status
func healthHandler(c *gin.Context) {
	if !IsOracleConfigured() {
		c.JSON(http.StatusServiceUnavailable, ErrorResponse{Error: "Oracle not configured"})
		return
	}

	balance, err := oracleClient.GetBalance(context.Background(), oracleClient.GetOraclePublicKey())
	if err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to get balance"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":      "ok",
		"network":     oracleClient.network,
		"oracle":      oracleClient.GetOraclePublicKey().String(),
		"balance_sol": float64(balance) / 1e9,
	})
}

// getEscrowHandler fetches an escrow account by buyer/seller
func getEscrowHandler(c *gin.Context) {
	if !IsOracleConfigured() {
		c.JSON(http.StatusServiceUnavailable, ErrorResponse{Error: "Oracle not configured"})
		return
	}

	buyerStr := c.Param("buyer")
	sellerStr := c.Param("seller")

	buyer, err := sol.PublicKeyFromBase58(buyerStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Invalid buyer public key"})
		return
	}

	seller, err := sol.PublicKeyFromBase58(sellerStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Invalid seller public key"})
		return
	}

	escrow, err := oracleClient.CheckEscrowStatus(context.Background(), buyer, seller)
	if err != nil {
		c.JSON(http.StatusNotFound, ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"buyer":              escrow.Buyer.String(),
		"seller":             escrow.Seller.String(),
		"amount_lamports":    escrow.Amount,
		"amount_sol":         float64(escrow.Amount) / 1e9,
		"bandwidth_limit_gb": escrow.BandwidthLimitGB,
		"bandwidth_used_gb":  escrow.BandwidthUsedGB,
		"status":             escrow.Status.String(),
		"created_at":         escrow.CreatedAt,
		"expires_at":         escrow.ExpiresAt,
	})
}

// SettleEscrowRequest is the request body for settlement
type SettleEscrowRequest struct {
	Buyer           string `json:"buyer" binding:"required"`
	Seller          string `json:"seller" binding:"required"`
	BandwidthUsedGB uint64 `json:"bandwidth_used_gb" binding:"required"`
}

// settleEscrowHandler settles an escrow by paying the seller proportionally
func settleEscrowHandler(c *gin.Context) {
	if !IsOracleConfigured() {
		c.JSON(http.StatusServiceUnavailable, ErrorResponse{Error: "Oracle not configured"})
		return
	}

	var req SettleEscrowRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Invalid request body"})
		return
	}

	buyer, err := sol.PublicKeyFromBase58(req.Buyer)
	if err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Invalid buyer public key"})
		return
	}

	seller, err := sol.PublicKeyFromBase58(req.Seller)
	if err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Invalid seller public key"})
		return
	}

	// Derive escrow PDA
	escrowPDA, _, err := oracleClient.GetEscrowPDA(buyer, seller)
	if err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to derive escrow PDA"})
		return
	}

	// Verify escrow exists and is in valid state
	escrow, err := oracleClient.FetchEscrow(context.Background(), escrowPDA)
	if err != nil {
		c.JSON(http.StatusNotFound, ErrorResponse{Error: "Escrow not found: " + err.Error()})
		return
	}

	if escrow.Status != EscrowPending && escrow.Status != EscrowActive {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Escrow already settled or refunded"})
		return
	}

	// Execute settlement
	txSig, err := oracleClient.SettleEscrow(context.Background(), "solana.handlers.settle", SettleEscrowParams{
		Buyer:           buyer,
		Seller:          seller,
		EscrowPDA:       escrowPDA,
		BandwidthUsedGB: req.BandwidthUsedGB,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Settlement failed: " + err.Error()})
		return
	}

	// Calculate payout for response
	usageRatio := float64(minUint64(req.BandwidthUsedGB, escrow.BandwidthLimitGB)) / float64(escrow.BandwidthLimitGB)
	sellerPayout := uint64(float64(escrow.Amount) * usageRatio)
	buyerRefund := escrow.Amount - sellerPayout

	c.JSON(http.StatusOK, gin.H{
		"status":            "settled",
		"transaction":       txSig,
		"explorer_url":      fmt.Sprintf("https://explorer.solana.com/tx/%s?cluster=%s", txSig, oracleClient.network),
		"seller_payout_sol": float64(sellerPayout) / 1e9,
		"buyer_refund_sol":  float64(buyerRefund) / 1e9,
	})
}

// minUint64 returns the smaller of two uint64 values
func minUint64(a, b uint64) uint64 {
	if a < b {
		return a
	}
	return b
}
