package api

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	ethcrypto "github.com/ethereum/go-ethereum/crypto"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func newTestSolanaKey(t *testing.T) (ed25519.PrivateKey, string) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return priv, base58.Encode(pub)
}

func signSolana(priv ed25519.PrivateKey, message string) string {
	return base58.Encode(ed25519.Sign(priv, []byte(message)))
}

func linkRouter(userID uuid.UUID) http.Handler {
	r := setupTestRouter()
	r.Use(authMiddlewareMock(userID.String(), "buyer"))
	r.POST("/wallet/link/challenge", getWalletLinkChallenge)
	r.POST("/wallet/link", linkWallet)
	r.DELETE("/wallet/link", linkWallet)
	r.GET("/linked-wallets", ListLinkedWallets)
	r.POST("/linked-wallets", LinkWallet)
	r.PUT("/linked-wallets/:id/primary", SetPrimaryWallet)
	r.DELETE("/linked-wallets/:id", UnlinkWallet)
	return r
}

func doJSON(t *testing.T, h http.Handler, method, path string, body map[string]interface{}) *httptest.ResponseRecorder {
	t.Helper()
	var buf *bytes.Buffer
	if body != nil {
		raw, _ := json.Marshal(body)
		buf = bytes.NewBuffer(raw)
	} else {
		buf = bytes.NewBuffer(nil)
	}
	req := httptest.NewRequest(method, path, buf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func fetchChallenge(t *testing.T, h http.Handler, chain, address string) string {
	t.Helper()
	w := doJSON(t, h, http.MethodPost, "/wallet/link/challenge", map[string]interface{}{
		"chain": chain, "wallet_address": address,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("challenge: expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	var resp struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil || resp.Message == "" {
		t.Fatalf("challenge body: %s", w.Body.String())
	}
	return resp.Message
}

func cleanupLinkP0(t *testing.T) {
	t.Helper()
	testutil.CleanupTestData(t, "users", "wallets", "linked_wallets")
}

// W-14 regression: a valid signature over a self-invented (non-challenge)
// message no longer links; a server challenge links exactly once.
func TestLinkWallet_P0_ChallengeRequiredAndSingleUse(t *testing.T) {
	testutil.SetupTestDB(t)
	cleanupLinkP0(t)
	user, _ := createWalletTestUser(t)
	priv, addr := newTestSolanaKey(t)
	h := linkRouter(user.ID)

	// Old-style static message with a valid signature must be rejected.
	staticMsg := fmt.Sprintf("Link Wallet %s to ProxyHubb User %s", addr, user.ID.String())
	w := doJSON(t, h, http.MethodPost, "/wallet/link", map[string]interface{}{
		"wallet_address": addr, "chain": "solana",
		"signature": signSolana(priv, staticMsg), "message": staticMsg,
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("static-message link: expected 400, got %d (%s)", w.Code, w.Body.String())
	}

	// Proper challenge flow links and sets identity + cooldown anchor.
	msg := fetchChallenge(t, h, "solana", addr)
	w = doJSON(t, h, http.MethodPost, "/wallet/link", map[string]interface{}{
		"wallet_address": addr, "chain": "solana",
		"signature": signSolana(priv, msg), "message": msg,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("challenge link: expected 200, got %d (%s)", w.Code, w.Body.String())
	}

	var prof models.User
	if err := db.DB.Where("id = ?", user.ID).First(&prof).Error; err != nil {
		t.Fatalf("profile: %v", err)
	}
	if prof.WalletAddress == nil || *prof.WalletAddress != addr {
		t.Fatalf("profile wallet_address not set: %v", prof.WalletAddress)
	}
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatalf("wallet: %v", err)
	}
	if wallet.PrimaryWithdrawalAddress == nil || *wallet.PrimaryWithdrawalAddress != addr {
		t.Fatalf("primary withdrawal address not set")
	}
	if wallet.WithdrawalAddressChangedAt == nil || time.Since(*wallet.WithdrawalAddressChangedAt) > time.Minute {
		t.Fatalf("cooldown anchor must be fresh, got %v", wallet.WithdrawalAddressChangedAt)
	}

	// Replay of the consumed challenge must fail.
	w = doJSON(t, h, http.MethodPost, "/wallet/link", map[string]interface{}{
		"wallet_address": addr, "chain": "solana",
		"signature": signSolana(priv, msg), "message": msg,
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("replayed challenge: expected 400, got %d (%s)", w.Code, w.Body.String())
	}
}

// W-04 regression: linking a first Solana wallet via /linked-wallets goes
// through the same identity path — primary + cooldown are set, so the
// endpoint choice can no longer bypass the 24h withdrawal cooldown.
func TestLinkWallet_P0_LinkedWalletsPathSetsCooldown(t *testing.T) {
	testutil.SetupTestDB(t)
	cleanupLinkP0(t)
	user, _ := createWalletTestUser(t)
	// Simulate the pre-link state the bypass relied on: no routing state.
	db.DB.Model(&models.Wallet{}).Where("user_id = ?", user.ID).Updates(map[string]interface{}{
		"primary_withdrawal_address": nil, "withdrawal_address_changed_at": nil,
	})
	priv, addr := newTestSolanaKey(t)
	h := linkRouter(user.ID)

	msg := fetchChallenge(t, h, "solana", addr)
	w := doJSON(t, h, http.MethodPost, "/linked-wallets", map[string]interface{}{
		"chain": "solana", "address": addr,
		"signature": signSolana(priv, msg), "message": msg,
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("linked-wallets link: expected 201, got %d (%s)", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "verification_signature") && !strings.Contains(w.Body.String(), `"verification_signature":null`) {
		t.Fatalf("response must not leak signature material: %s", w.Body.String())
	}

	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatalf("wallet: %v", err)
	}
	if wallet.PrimaryWithdrawalAddress == nil || *wallet.PrimaryWithdrawalAddress != addr {
		t.Fatal("W-04 regression: primary withdrawal address not set via /linked-wallets path")
	}
	if wallet.WithdrawalAddressChangedAt == nil || time.Since(*wallet.WithdrawalAddressChangedAt) > time.Minute {
		t.Fatal("W-04 regression: cooldown anchor not set via /linked-wallets path")
	}
}

// W-05 regression: linking Ethereum must not overwrite the Solana identity.
func TestLinkWallet_P0_EthereumDoesNotOverwriteSolana(t *testing.T) {
	testutil.SetupTestDB(t)
	cleanupLinkP0(t)
	user, _ := createWalletTestUser(t)
	priv, solAddr := newTestSolanaKey(t)
	h := linkRouter(user.ID)

	msg := fetchChallenge(t, h, "solana", solAddr)
	if w := doJSON(t, h, http.MethodPost, "/wallet/link", map[string]interface{}{
		"wallet_address": solAddr, "chain": "solana",
		"signature": signSolana(priv, msg), "message": msg,
	}); w.Code != http.StatusOK {
		t.Fatalf("solana link: %d (%s)", w.Code, w.Body.String())
	}

	// Link an Ethereum wallet with a personal-sign signature over a challenge.
	ethKey, err := ethcrypto.GenerateKey()
	if err != nil {
		t.Fatalf("eth key: %v", err)
	}
	ethAddr := ethcrypto.PubkeyToAddress(ethKey.PublicKey).Hex()
	ethMsg := fetchChallenge(t, h, "ethereum", ethAddr)
	prefixed := fmt.Sprintf("\x19Ethereum Signed Message:\n%d%s", len(ethMsg), ethMsg)
	hash := ethcrypto.Keccak256Hash([]byte(prefixed))
	sig, err := ethcrypto.Sign(hash.Bytes(), ethKey)
	if err != nil {
		t.Fatalf("eth sign: %v", err)
	}
	sig[64] += 27

	w := doJSON(t, h, http.MethodPost, "/wallet/link", map[string]interface{}{
		"wallet_address": ethAddr, "chain": "ethereum",
		"signature": "0x" + hex.EncodeToString(sig), "message": ethMsg,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("ethereum link: expected 200, got %d (%s)", w.Code, w.Body.String())
	}

	var prof models.User
	db.DB.Where("id = ?", user.ID).First(&prof)
	if prof.WalletAddress == nil || *prof.WalletAddress != solAddr {
		t.Fatalf("W-05 regression: Solana identity overwritten: %v", prof.WalletAddress)
	}
	var ethRow models.LinkedWallet
	if err := db.DB.Where("user_id = ? AND chain = ? AND address = ?", user.ID, models.ChainEthereum, ethAddr).First(&ethRow).Error; err != nil {
		t.Fatalf("ethereum linked row missing: %v", err)
	}
	if !ethRow.Verified {
		t.Fatal("ethereum row must be verified")
	}
}

// W-04: changing the primary Solana wallet requires a fresh signature from
// the new wallet and refreshes the cooldown anchor.
func TestSetPrimaryWallet_P0_RequiresSignatureAndSetsCooldown(t *testing.T) {
	testutil.SetupTestDB(t)
	cleanupLinkP0(t)
	user, _ := createWalletTestUser(t)
	privA, addrA := newTestSolanaKey(t)
	privB, addrB := newTestSolanaKey(t)
	h := linkRouter(user.ID)

	link := func(priv ed25519.PrivateKey, addr string, want int) {
		t.Helper()
		msg := fetchChallenge(t, h, "solana", addr)
		w := doJSON(t, h, http.MethodPost, "/linked-wallets", map[string]interface{}{
			"chain": "solana", "address": addr,
			"signature": signSolana(priv, msg), "message": msg,
		})
		if w.Code != want {
			t.Fatalf("link %s: expected %d, got %d (%s)", addr, want, w.Code, w.Body.String())
		}
	}
	link(privA, addrA, http.StatusCreated)
	link(privB, addrB, http.StatusCreated)

	// Age A's cooldown so a refresh is observable.
	old := time.Now().Add(-48 * time.Hour)
	db.DB.Model(&models.Wallet{}).Where("user_id = ?", user.ID).Update("withdrawal_address_changed_at", old)

	var rowB models.LinkedWallet
	if err := db.DB.Where("user_id = ? AND address = ?", user.ID, addrB).First(&rowB).Error; err != nil {
		t.Fatalf("row B: %v", err)
	}

	// Session-only primary change must be refused.
	w := doJSON(t, h, http.MethodPut, "/linked-wallets/"+rowB.ID.String()+"/primary", map[string]interface{}{})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("unsigned set-primary: expected 400, got %d (%s)", w.Code, w.Body.String())
	}

	msg := fetchChallenge(t, h, "solana", addrB)
	w = doJSON(t, h, http.MethodPut, "/linked-wallets/"+rowB.ID.String()+"/primary", map[string]interface{}{
		"signature": signSolana(privB, msg), "message": msg,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("signed set-primary: expected 200, got %d (%s)", w.Code, w.Body.String())
	}

	var wallet models.Wallet
	db.DB.Where("user_id = ?", user.ID).First(&wallet)
	if wallet.PrimaryWithdrawalAddress == nil || *wallet.PrimaryWithdrawalAddress != addrB {
		t.Fatal("primary withdrawal address not updated to B")
	}
	if wallet.WithdrawalAddressChangedAt == nil || !wallet.WithdrawalAddressChangedAt.After(old) {
		t.Fatal("cooldown anchor must refresh on primary change")
	}
	var prof models.User
	db.DB.Where("id = ?", user.ID).First(&prof)
	if prof.WalletAddress == nil || *prof.WalletAddress != addrB {
		t.Fatal("profile identity must follow the primary Solana wallet")
	}
}
