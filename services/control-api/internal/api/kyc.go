package api

import (
	"net/http"
	"strconv"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
)

// RegisterKYCRoutes registers KYC webhook routes
func RegisterKYCRoutes(rg *gin.RouterGroup) {
	kyc := rg.Group("/kyc")
	{
		kyc.POST("/webhook", handleKYCWebhook)
		kyc.GET("/status/:user_id", getKYCStatus)
	}
}

type KYCWebhookPayload struct {
	UserID string `json:"user_id" binding:"required"`
	Status string `json:"status" binding:"required"` // approved | rejected | pending
	Reason string `json:"reason"`
}

// handleKYCWebhook processes notifications from external KYC providers (stub)
func handleKYCWebhook(c *gin.Context) {
	// P0: In production, verify webhook signature/source IP here.
	
	var payload KYCWebhookPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	uid, err := uuid.Parse(payload.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var user models.User
	if err := db.DB.First(&user, "id = ?", uid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Map external status to internal KYCStatus
	var internalStatus models.KYCStatus
	switch payload.Status {
	case "approved":
		// P2: Mandatory Balance check before upgrading to Verified
		if user.WalletAddress == nil || *user.WalletAddress == "" {
			internalStatus = models.KYCStatusPending
			// P2: Update user message/reason in production
		} else {
			// Check on-chain balance
			minBalanceSOL := 0.05 // Default
			if manager := GetConfigManager(); manager != nil {
				if val, err := manager.Get("kyc.min_sol_balance"); err == nil {
					if f, err := strconv.ParseFloat(val, 64); err == nil {
						minBalanceSOL = f
					}
				}
			}

			oracle := solana.GetOracleClient()
			if oracle != nil {
				pubkey, err := sol.PublicKeyFromBase58(*user.WalletAddress)
				if err == nil {
					balanceLamports, err := oracle.GetBalance(c.Request.Context(), pubkey)
					if err == nil {
						balanceSOL := solana.LamportsToSOL(balanceLamports)
						if balanceSOL < minBalanceSOL {
							internalStatus = models.KYCStatusInsufficientFunds
						} else {
							internalStatus = models.KYCStatusApproved
							user.TrustTier = models.TrustTierVerified
						}
					} else {
						// RPC error, keep it pending to retry later or mark as error
						internalStatus = models.KYCStatusPending
					}
				} else {
					internalStatus = models.KYCStatusPending
				}
			} else {
				// No oracle? fallback to standard approval if oracle is down or skip
				internalStatus = models.KYCStatusApproved
				user.TrustTier = models.TrustTierVerified
			}
		}
	case "rejected":
		internalStatus = models.KYCStatusRejected
	case "pending":
		internalStatus = models.KYCStatusPending
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown status"})
		return
	}

	user.KYCStatus = internalStatus
	user.UpdatedAt = time.Now()

	if err := db.DB.Save(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update user KYC status"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "KYC status updated",
		"user_id": payload.UserID,
		"status":  internalStatus,
	})
}

func getKYCStatus(c *gin.Context) {
	userID := c.Param("user_id")
	uid, err := uuid.Parse(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var user models.User
	if err := db.DB.Select("kyc_status, trust_tier").First(&user, "id = ?", uid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"user_id":    userID,
		"kyc_status": user.KYCStatus,
		"trust_tier": user.TrustTier,
	})
}
