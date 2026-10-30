package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// setupGoogleLoginTest prepares the DB (incl. the auth.users stub that production gets
// from infra/postgres/init/00_auth_schema.sql), config env, email vault hooks, and a
// stubbed Google verifier.
func setupGoogleLoginTest(t *testing.T, identity googleIdentity, verifyErr error) *gin.Engine {
	t.Helper()
	testutil.SetupTestDB(t)
	if err := db.DB.Exec(`CREATE SCHEMA IF NOT EXISTS auth;
		CREATE TABLE IF NOT EXISTS auth.users (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			email VARCHAR(255) UNIQUE,
			raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW())`).Error; err != nil {
		t.Fatalf("auth schema: %v", err)
	}
	testutil.CleanupTestData(t, "user_identities", "embedded_wallets", "linked_wallets", "profile_private", "wallets", "users")
	t.Cleanup(func() { db.DB.Exec("DELETE FROM auth.users") })
	gin.SetMode(gin.TestMode)

	t.Setenv("DATABASE_URL", "postgres://unused-by-handler") // config.Load requires it
	t.Setenv("JWT_SECRET", "test-jwt-secret-for-google-login-0123456789")
	t.Setenv("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com")
	t.Setenv("EMBEDDED_WALLET_KEK", strings.Repeat("ab", 32))
	t.Setenv("APP_ENV", "development")

	withTestCredentialCipher(t)
	prevHash := models.EmailHashFn
	models.EmailHashFn = func(email string) string {
		sum := sha256.Sum256([]byte("pepper|" + email))
		return hex.EncodeToString(sum[:])
	}
	t.Cleanup(func() { models.EmailHashFn = prevHash })

	prevVerify := verifyGoogleToken
	verifyGoogleToken = func(_ context.Context, credential, clientID string) (googleIdentity, error) {
		if clientID != "test-client.apps.googleusercontent.com" {
			t.Fatalf("verifier got client id %q", clientID)
		}
		return identity, verifyErr
	}
	t.Cleanup(func() { verifyGoogleToken = prevVerify })

	r := setupTestRouter()
	r.POST("/auth/google", googleLogin)
	return r
}

func postGoogle(r *gin.Engine) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/auth/google", bytes.NewReader([]byte(`{"credential":"fake-id-token"}`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestGoogleLoginCreatesAccountAndManagedWallet(t *testing.T) {
	r := setupGoogleLoginTest(t, googleIdentity{Subject: "google-sub-1", Email: "Ama.Mensah@Gmail.com", EmailVerified: true}, nil)

	w := postGoogle(r)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	for _, secret := range []string{"sealed_key", "wrapped_dek", "kek_id"} {
		if strings.Contains(body, secret) {
			t.Fatalf("response leaks %q: %s", secret, body)
		}
	}
	var resp struct {
		Token string      `json:"token"`
		User  models.User `json:"user"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil || resp.Token == "" {
		t.Fatalf("decode: %v token=%q", err, resp.Token)
	}
	userID := resp.User.ID

	var ident models.UserIdentity
	if err := db.DB.Where("provider = ? AND subject = ?", "google", "google-sub-1").First(&ident).Error; err != nil || ident.UserID != userID {
		t.Fatalf("identity row: %v (user %s)", err, ident.UserID)
	}
	var ew models.EmbeddedWallet
	if err := db.DB.Where("user_id = ?", userID).First(&ew).Error; err != nil {
		t.Fatalf("embedded wallet: %v", err)
	}
	var profile struct {
		WalletAddress *string
		Email         *string
		EmailHash     *string
	}
	db.DB.Raw("SELECT wallet_address, email, email_hash FROM profiles WHERE id = ?", userID).Scan(&profile)
	if profile.WalletAddress == nil || *profile.WalletAddress != ew.Address {
		t.Fatalf("profile wallet %v, embedded %s", profile.WalletAddress, ew.Address)
	}
	if profile.Email != nil || profile.EmailHash == nil || *profile.EmailHash != models.HashEmail("ama.mensah@gmail.com") {
		t.Fatalf("email should be vaulted + hashed: email=%v hash=%v", profile.Email, profile.EmailHash)
	}
	var linked models.LinkedWallet
	if err := db.DB.Where("user_id = ? AND is_primary = ?", userID, true).First(&linked).Error; err != nil || linked.Address != ew.Address {
		t.Fatalf("primary linked wallet: %v %s", err, linked.Address)
	}
	var ledger int64
	db.DB.Model(&models.Wallet{}).Where("user_id = ?", userID).Count(&ledger)
	if ledger != 1 {
		t.Fatalf("expected 1 ledger wallet row, got %d", ledger)
	}

	// Second sign-in with the same Google account: same user, still one wallet.
	w2 := postGoogle(r)
	if w2.Code != http.StatusOK {
		t.Fatalf("second login status=%d body=%s", w2.Code, w2.Body.String())
	}
	var resp2 struct {
		User models.User `json:"user"`
	}
	_ = json.Unmarshal(w2.Body.Bytes(), &resp2)
	var wallets int64
	db.DB.Model(&models.EmbeddedWallet{}).Where("user_id = ?", userID).Count(&wallets)
	if resp2.User.ID != userID || wallets != 1 {
		t.Fatalf("second login: user %s (want %s), embedded wallets %d", resp2.User.ID, userID, wallets)
	}
}

func TestGoogleLoginRejectsUnverifiedEmail(t *testing.T) {
	r := setupGoogleLoginTest(t, googleIdentity{Subject: "google-sub-2", Email: "x@example.com", EmailVerified: false}, nil)
	if w := postGoogle(r); w.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var n int64
	db.DB.Model(&models.UserIdentity{}).Count(&n)
	if n != 0 {
		t.Fatalf("no identity should be created, got %d", n)
	}
}

func TestGoogleLoginRejectsInvalidToken(t *testing.T) {
	r := setupGoogleLoginTest(t, googleIdentity{}, errors.New("bad signature"))
	if w := postGoogle(r); w.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestGoogleLoginNotConfigured(t *testing.T) {
	r := setupGoogleLoginTest(t, googleIdentity{Subject: "s", Email: "a@b.c", EmailVerified: true}, nil)
	t.Setenv("GOOGLE_CLIENT_ID", "")
	if w := postGoogle(r); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestGoogleSignupUnavailableWithoutKEK(t *testing.T) {
	r := setupGoogleLoginTest(t, googleIdentity{Subject: "google-sub-3", Email: "c@example.com", EmailVerified: true}, nil)
	t.Setenv("EMBEDDED_WALLET_KEK", "")
	if w := postGoogle(r); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var idents, authUsers int64
	db.DB.Model(&models.UserIdentity{}).Where("subject = ?", "google-sub-3").Count(&idents)
	db.DB.Raw("SELECT COUNT(*) FROM auth.users WHERE email = ?", "c@example.com").Scan(&authUsers)
	if idents != 0 || authUsers != 0 {
		t.Fatalf("no account should be created without a KEK: identities=%d auth.users=%d", idents, authUsers)
	}
}
