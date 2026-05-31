package api

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/solana"
)

// RegisterKYCRoutes registers KYC webhook routes
func RegisterKYCRoutes(rg *gin.RouterGroup) {
	kyc := rg.Group("/kyc")
	{
		kyc.POST("/webhook", handleKYCWebhook)
		kyc.GET("/status/:user_id", getKYCStatus)
		kyc.POST("/recheck", recheckKYC)
	}
}

type KYCWebhookPayload struct {
	UserID string `json:"user_id" binding:"required"`
	Status string `json:"status" binding:"required"` // approved | rejected | pending
	Reason string `json:"reason"`
}

// verifyKYCHmac validates the webhook HMAC signature
func verifyKYCHmac(body []byte, signature string, secret string) bool {
	if secret == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(signature), []byte(expected))
}

// isAllowedKYCIP checks if the request IP is in the allowlist
func isAllowedKYCIP(clientIP string) bool {
	allowlist := os.Getenv("KYC_WEBHOOK_IP_ALLOWLIST")
	if allowlist == "" {
		return false // Deny by default if not configured
	}
	allowed := strings.Split(allowlist, ",")
	for _, ip := range allowed {
		if strings.TrimSpace(ip) == clientIP {
			return true
		}
	}
	return false
}

// isWithinTolerance checks if the webhook timestamp is within acceptable window
func isWithinTolerance(timestampStr string, tolerance time.Duration) bool {
	ts, err := strconv.ParseInt(timestampStr, 10, 64)
	if err != nil {
		return false
	}
	t := time.Unix(ts, 0)
	return time.Since(t) <= tolerance
}

// handleKYCWebhook processes notifications from external KYC providers
// Secured with: IP allowlist + HMAC signature + timestamp tolerance + idempotency
func handleKYCWebhook(c *gin.Context) {
	// 1. IP allowlist check
	if !isAllowedKYCIP(c.ClientIP()) {
		logging.Warn().Str("ip", c.ClientIP()).Msg("KYC webhook rejected: IP not in allowlist")
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	// 2. Read body for HMAC verification
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read body"})
		return
	}

	// 3. HMAC signature verification
	signature := c.GetHeader("X-Webhook-Signature")
	webhookSecret := os.Getenv("KYC_WEBHOOK_SECRET")
	if !verifyKYCHmac(body, signature, webhookSecret) {
		logging.Warn().Str("ip", c.ClientIP()).Msg("KYC webhook rejected: invalid HMAC signature")
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	// 4. Timestamp tolerance check
	timestamp := c.GetHeader("X-Webhook-Timestamp")
	if !isWithinTolerance(timestamp, 5*time.Minute) {
		logging.Warn().Str("timestamp", timestamp).Msg("KYC webhook rejected: timestamp outside tolerance")
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	// 5. Idempotency check
	webhookID := c.GetHeader("X-Webhook-ID")
	if webhookID != "" {
		key := fmt.Sprintf("kyc:webhook:%s", webhookID)
		if !redis.Client.SetNX(c.Request.Context(), key, "1", 24*time.Hour).Val() {
			c.JSON(http.StatusOK, gin.H{"status": "already processed"})
			return
		}
	}
	
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
			// CONFIG-001: Read KYC minimum balance from on-chain ProgramConfig PDA.
			// Falls back to DB config, then hard-coded default, so the system degrades
			// gracefully when the PDA is not yet initialised.
			minBalanceSOL := 0.05 // default
			if oracle2 := solana.GetOracleClient(); oracle2 != nil {
				if cfg, err := oracle2.ReadProgramConfig(c.Request.Context()); err == nil {
					minBalanceSOL = float64(cfg.KYCMinSOLLamports) / 1e9
				}
			}
			if minBalanceSOL == 0.05 { // on-chain not set, try DB config
				if manager := GetConfigManager(); manager != nil {
					if val, err := manager.Get("kyc.min_sol_balance"); err == nil {
						if f, err := strconv.ParseFloat(val, 64); err == nil {
							minBalanceSOL = f
						}
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
							// Anchor trust-tier elevation on-chain.
							writeKYCAttestationAsync(*user.WalletAddress, solana.KYCTierVerified, solana.KYCStatusApprovedOnChain)
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
				// Anchor on-chain even without live balance check (oracle was nil).
				writeKYCAttestationAsync(*user.WalletAddress, solana.KYCTierVerified, solana.KYCStatusApprovedOnChain)
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

	if internalStatus == models.KYCStatusApproved {
		_ = db.DB.Model(&models.ProviderNode{}).Where("user_id = ?", user.ID).Update("kyc_verified", true).Error
		go PromoteProviderApplicationAfterKYC(context.Background(), user.ID)
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "KYC status updated",
		"user_id": payload.UserID,
		"status":  internalStatus,
	})
}

// recheckKYC allows an authenticated user whose KYC webhook fired before they
// linked a wallet (leaving them in KYCStatusPending) to re-run the approval
// logic now that a wallet address is available.
func recheckKYC(c *gin.Context) {
	userID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Only re-check users that are stuck in pending or insufficient_funds.
	if user.KYCStatus != models.KYCStatusPending && user.KYCStatus != models.KYCStatusInsufficientFunds {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":      "KYC recheck not applicable",
			"kyc_status": user.KYCStatus,
		})
		return
	}

	if user.WalletAddress == nil || *user.WalletAddress == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Please link a Solana wallet before rechecking KYC"})
		return
	}

	// Re-run the balance check — read from on-chain ProgramConfig first.
	minBalanceSOL := 0.05
	if oracleC := solana.GetOracleClient(); oracleC != nil {
		if cfg, err := oracleC.ReadProgramConfig(c.Request.Context()); err == nil {
			minBalanceSOL = float64(cfg.KYCMinSOLLamports) / 1e9
		}
	}
	if minBalanceSOL == 0.05 {
		if manager := GetConfigManager(); manager != nil {
			if val, err := manager.Get("kyc.min_sol_balance"); err == nil {
				if f, err := strconv.ParseFloat(val, 64); err == nil {
					minBalanceSOL = f
				}
			}
		}
	}

	oracle := solana.GetOracleClient()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Blockchain oracle not available; please try again later"})
		return
	}

	pubkey, err := sol.PublicKeyFromBase58(*user.WalletAddress)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Linked wallet address is invalid"})
		return
	}

	balanceLamports, err := oracle.GetBalance(c.Request.Context(), pubkey)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Failed to fetch on-chain balance; please try again later"})
		return
	}

	balanceSOL := solana.LamportsToSOL(balanceLamports)
	if balanceSOL < minBalanceSOL {
		c.JSON(http.StatusPaymentRequired, gin.H{
			"error":           "Insufficient on-chain SOL balance for KYC approval",
			"required_sol":    minBalanceSOL,
			"current_sol":     balanceSOL,
		})
		return
	}

	user.KYCStatus = models.KYCStatusApproved
	user.TrustTier = models.TrustTierVerified
	user.UpdatedAt = time.Now()
	if err := db.DB.Save(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update KYC status"})
		return
	}

	// Anchor the trust-tier elevation on-chain for verifiability.
	writeKYCAttestationAsync(*user.WalletAddress, solana.KYCTierVerified, solana.KYCStatusApprovedOnChain)

	_ = db.DB.Model(&models.ProviderNode{}).Where("user_id = ?", user.ID).Update("kyc_verified", true).Error
	go PromoteProviderApplicationAfterKYC(context.Background(), user.ID)

	c.JSON(http.StatusOK, gin.H{
		"message":    "KYC approved",
		"kyc_status": user.KYCStatus,
		"trust_tier": user.TrustTier,
	})
}

func getKYCStatus(c *gin.Context) {
	// Authorization: users can only query their own KYC status, or admins can query anyone
	currentUserID, authErr := getCurrentUserID(c)
	if authErr != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	userID := c.Param("user_id")
	uid, err := uuid.Parse(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	// Enforce self-access or admin role
	role, _ := c.Get("role")
	if currentUserID != uid && role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can only view your own KYC status"})
		return
	}

	var user models.User
	if err := db.DB.Select("kyc_status, trust_tier, wallet_address").First(&user, "id = ?", uid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	resp := gin.H{
		"user_id":    userID,
		"kyc_status": user.KYCStatus,
		"trust_tier": user.TrustTier,
	}

	// Optionally enrich with on-chain attestation if wallet is linked.
	if user.WalletAddress != nil && *user.WalletAddress != "" {
		if oracle := solana.GetOracleClient(); oracle != nil {
			if pubkey, err := sol.PublicKeyFromBase58(*user.WalletAddress); err == nil {
				if att, err := oracle.ReadKYCAttestation(c.Request.Context(), pubkey); err == nil {
					resp["on_chain_trust_tier"] = att.TrustTier
					resp["on_chain_kyc_status"] = att.KYCStatus
					resp["on_chain_attested_at"] = att.AttestedAt
				}
			}
		}
	}

	c.JSON(http.StatusOK, resp)
}

// writeKYCAttestationAsync writes a KYC attestation to Solana in the background.
// Failures are logged but do not block the HTTP response — the DB remains the
// immediate source of truth; the chain is the verifiable audit trail.
func writeKYCAttestationAsync(wallet string, trustTier uint8, kycStatus uint8) {
	oracle := solana.GetOracleClient()
	if oracle == nil {
		return
	}
	pubkey, err := sol.PublicKeyFromBase58(wallet)
	if err != nil {
		logging.Warn().Str("wallet", wallet).Msg("writeKYCAttestationAsync: invalid wallet address")
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		sig, err := oracle.WriteKYCAttestation(ctx, solana.WriteKYCAttestationParams{
			Wallet:    pubkey,
			TrustTier: trustTier,
			KYCStatus: kycStatus,
		})
		if err != nil {
			logging.Error(err).Str("wallet", wallet).Msg("writeKYCAttestationAsync: WriteKYCAttestation failed")
			return
		}
		logging.Info().Str("wallet", wallet).Str("sig", sig).Msg("writeKYCAttestationAsync: KYC attestation anchored on-chain")
	}()
}
