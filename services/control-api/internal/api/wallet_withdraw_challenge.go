package api

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	solanaGo "github.com/gagliardetto/solana-go"
)

// W-13 (P1): withdrawals above the dust threshold require a wallet
// signature over a server-issued, single-use challenge that binds
// user + destination + EXACT lamports + 128-bit nonce. This replaces
// the legacy scheme (client-chosen second-granularity timestamp nonce,
// float %.6f amount binding, nonce burned before verification).

const withdrawChallengeTTL = 5 * time.Minute

var (
	withdrawMemStore      = make(map[string]memStoreEntry)
	withdrawMemStoreMutex sync.RWMutex
)

func withdrawChallengeKey(userID uuid.UUID, nonce string) string {
	return fmt.Sprintf("withdraw:nonce:%s:%s", userID.String(), nonce)
}

func buildWithdrawChallengeMessage(userID uuid.UUID, destination string, lamports int64, nonce string) string {
	return fmt.Sprintf("ProxyHubb withdrawal\nUser: %s\nDestination: %s\nLamports: %d\nNonce: %s",
		userID.String(), destination, lamports, nonce)
}

// getWithdrawSignatureThresholdLamports: signatures required ABOVE this
// many lamports (default 0.1 SOL). Configurable via system setting / env.
func getWithdrawSignatureThresholdLamports() int64 {
	raw := db.GetSystemSetting("withdraw_signature_threshold_lamports", "WITHDRAW_SIGNATURE_THRESHOLD_LAMPORTS", "100000000")
	if v, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64); err == nil && v >= 0 {
		return v
	}
	return 100_000_000
}

func issueWithdrawChallenge(ctx context.Context, userID uuid.UUID, destination string, lamports int64) (string, string, error) {
	randBytes := make([]byte, 16) // 128-bit nonce
	if _, err := rand.Read(randBytes); err != nil {
		return "", "", fmt.Errorf("generate withdraw nonce: %w", err)
	}
	nonce := hex.EncodeToString(randBytes)
	message := buildWithdrawChallengeMessage(userID, destination, lamports, nonce)
	key := withdrawChallengeKey(userID, nonce)

	if redisClient.Client != nil {
		_ = redisClient.Client.Set(ctx, key, message, withdrawChallengeTTL).Err()
	}
	withdrawMemStoreMutex.Lock()
	if len(withdrawMemStore) >= memStoreMaxEntries {
		now := time.Now()
		for k, e := range withdrawMemStore {
			if now.After(e.expiresAt) {
				delete(withdrawMemStore, k)
			}
		}
	}
	withdrawMemStore[key] = memStoreEntry{value: message, expiresAt: time.Now().Add(withdrawChallengeTTL)}
	withdrawMemStoreMutex.Unlock()
	return message, nonce, nil
}

// verifyWithdrawChallengeSignature verifies the Ed25519 signature FIRST,
// then atomically consumes the single-use challenge (verify-then-burn:
// a failed signature never consumes a legitimate challenge, and the
// atomic consume still prevents replay of a valid one).
func verifyWithdrawChallengeSignature(ctx context.Context, userID uuid.UUID, destination string, lamports int64, nonce, signature string) bool {
	if nonce == "" || signature == "" {
		return false
	}
	message := buildWithdrawChallengeMessage(userID, destination, lamports, nonce)
	pubKeyBytes, err := base58.Decode(destination)
	if err != nil || len(pubKeyBytes) != 32 {
		return false
	}
	sigBytes, err := base58.Decode(signature)
	if err != nil || len(sigBytes) != 64 {
		return false
	}
	if !ed25519.Verify(pubKeyBytes, []byte(message), sigBytes) {
		return false
	}
	return consumeWithdrawChallenge(ctx, userID, nonce, message)
}

func consumeWithdrawChallenge(ctx context.Context, userID uuid.UUID, nonce, presentedMessage string) bool {
	key := withdrawChallengeKey(userID, nonce)
	var stored string
	found := false
	if redisClient.Client != nil {
		if val, err := redisClient.Client.Eval(ctx, getAndDeleteScript, []string{key}).Text(); err == nil {
			stored, found = val, true
		}
	}
	withdrawMemStoreMutex.Lock()
	entry, inMem := withdrawMemStore[key]
	delete(withdrawMemStore, key)
	withdrawMemStoreMutex.Unlock()
	if !found && inMem && time.Now().Before(entry.expiresAt) {
		stored, found = entry.value, true
	}
	return found && stored == presentedMessage
}

type withdrawChallengeRequest struct {
	AmountLamports int64   `json:"amount_lamports"`
	Amount         float64 `json:"amount"`
}

// POST /v1/wallet/withdraw/challenge — issue the exact message to sign.
func getWithdrawChallenge(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	var req withdrawChallengeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	lamports := req.AmountLamports
	if lamports == 0 && req.Amount > 0 {
		lamports = int64(models.SOLToLamports(req.Amount))
	}
	if lamports <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "amount_lamports (or amount) must be positive"})
		return
	}

	var user models.User
	if err := db.DB.Select("id, wallet_address").Where("id = ?", userUUID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	if user.WalletAddress == nil || *user.WalletAddress == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No linked Solana wallet"})
		return
	}
	var walletRecord models.Wallet
	if err := db.DB.Where("user_id = ?", userUUID).First(&walletRecord).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}
	destAddress, err := walletRecord.WithdrawalDestination(user.WalletAddress)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	if _, err := solanaGo.PublicKeyFromBase58(destAddress); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Withdrawal address is invalid. Please re-link your Solana wallet."})
		return
	}

	message, nonce, err := issueWithdrawChallenge(c.Request.Context(), userUUID, destAddress, lamports)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to issue withdrawal challenge"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message":         message,
		"nonce":           nonce,
		"destination":     destAddress,
		"amount_lamports": lamports,
		"expires_in_secs": int(withdrawChallengeTTL.Seconds()),
	})
}
