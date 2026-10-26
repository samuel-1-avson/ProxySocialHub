package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
)

// P0-4 (W-14/W-15): wallet linking uses server-issued, single-use,
// short-lived challenges — the same pattern as wallet login — instead of
// accepting any (replayable, never-expiring) signed message. The stored
// message is compared verbatim, so it cryptographically binds
// user + chain + address + nonce together.

const linkChallengeTTL = 5 * time.Minute

var (
	linkMemStore      = make(map[string]memStoreEntry)
	linkMemStoreMutex sync.RWMutex
)

func linkChallengeKey(userID uuid.UUID, chain, address string) string {
	return fmt.Sprintf("link:nonce:%s:%s:%s", userID.String(), strings.ToLower(strings.TrimSpace(chain)), strings.TrimSpace(address))
}

func buildLinkChallengeMessage(userID uuid.UUID, chain, address, nonce string) string {
	return fmt.Sprintf("ProxyHubb wallet link\nUser: %s\nChain: %s\nWallet: %s\nNonce: %s",
		userID.String(), strings.ToLower(strings.TrimSpace(chain)), strings.TrimSpace(address), nonce)
}

// issueLinkChallenge creates and stores a fresh link challenge and returns
// the exact message the wallet must sign.
func issueLinkChallenge(ctx context.Context, userID uuid.UUID, chain, address string) (string, error) {
	randBytes := make([]byte, 32)
	if _, err := rand.Read(randBytes); err != nil {
		return "", fmt.Errorf("generate link nonce: %w", err)
	}
	nonce := hex.EncodeToString(randBytes)

	// Bind to a recent blockhash when available (mirrors login D-A1).
	if strings.EqualFold(chain, "solana") {
		if oracle := solanaClient.GetOracleClient(); oracle != nil {
			if bh, err := oracle.GetRecentBlockhash(ctx); err == nil && bh != "" {
				nonce = nonce + ":" + bh
			}
		}
	}

	message := buildLinkChallengeMessage(userID, chain, address, nonce)
	key := linkChallengeKey(userID, chain, address)

	if redisClient.Client != nil {
		_ = redisClient.Client.Set(ctx, key, message, linkChallengeTTL).Err()
	}
	linkMemStoreMutex.Lock()
	if len(linkMemStore) >= memStoreMaxEntries {
		now := time.Now()
		for k, e := range linkMemStore {
			if now.After(e.expiresAt) {
				delete(linkMemStore, k)
			}
		}
	}
	linkMemStore[key] = memStoreEntry{value: message, expiresAt: time.Now().Add(linkChallengeTTL)}
	linkMemStoreMutex.Unlock()

	return message, nil
}

// consumeLinkChallenge atomically consumes the pending challenge for
// (user, chain, address) and reports whether presentedMessage matches it
// exactly. Challenges are single-use whether they match or not.
func consumeLinkChallenge(ctx context.Context, userID uuid.UUID, chain, address, presentedMessage string) bool {
	key := linkChallengeKey(userID, chain, address)
	var stored string
	found := false

	if redisClient.Client != nil {
		if val, err := redisClient.Client.Eval(ctx, getAndDeleteScript, []string{key}).Text(); err == nil {
			stored, found = val, true
		}
	}

	linkMemStoreMutex.Lock()
	entry, inMem := linkMemStore[key]
	delete(linkMemStore, key)
	linkMemStoreMutex.Unlock()

	if !found && inMem && time.Now().Before(entry.expiresAt) {
		stored, found = entry.value, true
	}
	return found && stored == presentedMessage
}

type linkChallengeRequest struct {
	Chain         string `json:"chain" binding:"required"`
	WalletAddress string `json:"wallet_address"`
	Address       string `json:"address"`
}

// getWalletLinkChallenge issues a one-time message for the caller to sign
// with the wallet being linked. POST /v1/wallet/link/challenge
func getWalletLinkChallenge(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	var req linkChallengeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	address := strings.TrimSpace(req.WalletAddress)
	if address == "" {
		address = strings.TrimSpace(req.Address)
	}
	chain := strings.ToLower(strings.TrimSpace(req.Chain))
	if address == "" || (chain != "solana" && chain != "ethereum") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "wallet_address and a supported chain (solana|ethereum) are required"})
		return
	}

	message, err := issueLinkChallenge(c.Request.Context(), userUUID, chain, address)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to issue link challenge"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message":          message,
		"expires_in_secs":  int(linkChallengeTTL.Seconds()),
		"wallet_address":   address,
		"chain":            chain,
	})
}
