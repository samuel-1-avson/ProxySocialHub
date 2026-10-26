package api

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func setupWalletSecurityUser(t *testing.T, balance float64) (models.User, models.Wallet, string, ed25519.PrivateKey) {
	t.Helper()
	testutil.SetupTestRedis(t)

	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	addr := base58.Encode(pub)

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("wsec"), "buyer")
	user.WalletAddress = &addr
	if err := db.DB.Save(user).Error; err != nil {
		t.Fatalf("save user wallet: %v", err)
	}

	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatalf("load wallet: %v", err)
	}
	wallet.BalanceSOL = balance
	wallet.PrimaryWithdrawalAddress = &addr
	wallet.WithdrawalWhitelist = []string{}
	if err := db.DB.Save(&wallet).Error; err != nil {
		t.Fatalf("save wallet: %v", err)
	}

	return *user, wallet, addr, priv
}

func signWithdrawPayload(t *testing.T, priv ed25519.PrivateKey, amount float64) (nonce, signature string) {
	t.Helper()
	nonce = fmt.Sprintf("%d", time.Now().Unix())
	message := fmt.Sprintf("withdraw:%s:%.6f", nonce, amount)
	sig := ed25519.Sign(priv, []byte(message))
	return nonce, base58.Encode(sig)
}

func TestGetWithdrawalSecurity(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "profiles", "auth.users")

	user, wallet, addr, _ := setupWalletSecurityUser(t, 5.0)
	now := time.Now()
	wallet.WithdrawalAddressChangedAt = &now
	db.DB.Save(&wallet)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.GET("/wallet/withdrawal-security", getWithdrawalSecurity)

	req := httptest.NewRequest(http.MethodGet, "/wallet/withdrawal-security", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["primary_withdrawal_address"] != addr {
		t.Fatalf("expected primary %s got %v", addr, resp["primary_withdrawal_address"])
	}
	if resp["withdrawal_cooldown_active"] != true {
		t.Fatalf("expected cooldown active, got %v", resp["withdrawal_cooldown_active"])
	}
}

func TestUpdateWithdrawalWhitelist_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "profiles", "auth.users")

	user, _, addr, _ := setupWalletSecurityUser(t, 1.0)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.PUT("/wallet/withdrawal-security/whitelist", updateWithdrawalWhitelist)

	body, _ := json.Marshal(map[string]interface{}{"addresses": []string{addr}})
	req := httptest.NewRequest(http.MethodPut, "/wallet/withdrawal-security/whitelist", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// W-34: whitelist removed - endpoint is 410 Gone.
	if w.Code != http.StatusGone {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
}

func TestUpdateWithdrawalWhitelist_InvalidAddress(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "profiles", "auth.users")

	user, _, _, _ := setupWalletSecurityUser(t, 1.0)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.PUT("/wallet/withdrawal-security/whitelist", updateWithdrawalWhitelist)

	body, _ := json.Marshal(map[string]interface{}{"addresses": []string{"not-a-valid-address"}})
	req := httptest.NewRequest(http.MethodPut, "/wallet/withdrawal-security/whitelist", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// W-34: endpoint gone regardless of body validity.
	if w.Code != http.StatusGone {
		t.Fatalf("expected 410 got %d body %s", w.Code, w.Body.String())
	}
}

func TestWithdrawSOL_CooldownActive(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "profiles", "auth.users")

	user, wallet, _, _ := setupWalletSecurityUser(t, 50.0)
	now := time.Now()
	wallet.WithdrawalAddressChangedAt = &now
	db.DB.Save(&wallet)

	withWithdrawSOLMocks(t, func(ctx context.Context, o *solana.OracleClient, dest string, amount float64) (string, error) {
		return "unused", nil
	})

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/wallet/withdraw/sol", withdrawSOL)

	body, _ := json.Marshal(map[string]interface{}{"amount": 1.0})
	req := httptest.NewRequest(http.MethodPost, "/wallet/withdraw/sol", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 got %d body %s", w.Code, w.Body.String())
	}
}

func TestWithdrawSOL_LargeWithdrawRequiresSignature(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "profiles", "auth.users")

	user, wallet, _, _ := setupWalletSecurityUser(t, 50.0)
	// Cooldown expired
	past := time.Now().Add(-48 * time.Hour)
	wallet.WithdrawalAddressChangedAt = &past
	db.DB.Save(&wallet)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/wallet/withdraw/sol", withdrawSOL)

	body, _ := json.Marshal(map[string]interface{}{"amount": 15.0})
	req := httptest.NewRequest(http.MethodPost, "/wallet/withdraw/sol", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 got %d body %s", w.Code, w.Body.String())
	}
}

func TestWithdrawSOL_WhitelistIgnored_P2(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "profiles", "auth.users")

	// W-34: a stale whitelist that excludes the linked primary must no
	// longer block withdrawals (destination is pinned to linked wallet).
	user, wallet, _, _ := setupWalletSecurityUser(t, 20.0)
	other := "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9wYt5WGy"
	wallet.WithdrawalWhitelist = []string{other}
	past := time.Now().Add(-48 * time.Hour)
	wallet.WithdrawalAddressChangedAt = &past
	db.DB.Save(&wallet)

	withWithdrawSOLMocks(t, func(ctx context.Context, o *solana.OracleClient, dest string, amount float64) (string, error) {
		return "sig", nil
	})

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/wallet/withdraw/sol", withdrawSOL)

	body, _ := json.Marshal(map[string]interface{}{"amount": 1.0})
	req := httptest.NewRequest(http.MethodPost, "/wallet/withdraw/sol", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code == http.StatusForbidden {
		t.Fatalf("whitelist must not block after W-34 removal: %d body %s", w.Code, w.Body.String())
	}
	if w.Code != http.StatusOK && w.Code != http.StatusAccepted {
		t.Fatalf("expected withdraw to proceed, got %d body %s", w.Code, w.Body.String())
	}
}

func TestVerifyWithdrawalSignature_Valid(t *testing.T) {
	testutil.SetupTestRedis(t)

	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	addr := base58.Encode(pub)
	amount := 12.5
	nonce, sig := signWithdrawPayload(t, priv, amount)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)

	if !verifyWithdrawalSignature(c, addr, amount, nonce, sig) {
		t.Fatal("expected valid withdrawal signature")
	}
}

func TestVerifyWithdrawalSignature_ReplayRejected(t *testing.T) {
	testutil.SetupTestRedis(t)

	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	addr := base58.Encode(pub)
	amount := 12.5
	nonce, sig := signWithdrawPayload(t, priv, amount)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)

	if !verifyWithdrawalSignature(c, addr, amount, nonce, sig) {
		t.Fatal("first verify should pass")
	}
	if verifyWithdrawalSignature(c, addr, amount, nonce, sig) {
		t.Fatal("replay should be rejected")
	}
}
