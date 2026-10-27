package api

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// walletSigner is a stand-in for a Phantom account: an ed25519 key and its base58 address.
type walletSigner struct {
	priv    ed25519.PrivateKey
	address string
}

func newWalletSigner(t *testing.T) walletSigner {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return walletSigner{priv: priv, address: base58.Encode(pub)}
}

func authSessionRouter(t *testing.T) *gin.Engine {
	t.Helper()
	// walletLogin calls config.Load on every login, which insists on DATABASE_URL (it only reads
	// it; the tests use db.DB). The secrets mirror what CI sets for the whole job.
	t.Setenv("DATABASE_URL", "postgres://unused:unused@127.0.0.1:1/unused?sslmode=disable")
	t.Setenv("JWT_SECRET", "test-jwt-secret-for-ci-min-32-chars-long")
	t.Setenv("SESSION_SECRET", "test-session-secret-for-ci-min-32-chars")
	t.Setenv("ENCRYPTION_KEY", "test-encryption-key-for-ci-32-chars-xx")
	t.Setenv("TOKEN_HMAC_SECRET", "test-token-hmac-secret-for-ci-32-chars")

	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/v1/auth/wallet/challenge", getAuthChallenge)
	r.POST("/v1/auth/wallet/login", walletLogin)
	r.POST("/v1/auth/refresh", refreshSession)
	r.POST("/v1/auth/logout", logoutSession)
	return r
}

func postJSON(r *gin.Engine, path string, body interface{}, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(http.MethodPost, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	for _, c := range cookies {
		req.AddCookie(c)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// loginWithWallet runs the exact exchange the web app performs: ask for a challenge, sign the
// returned message, post it back as both `nonce` and `signature`.
func loginWithWallet(t *testing.T, r *gin.Engine, s walletSigner) *httptest.ResponseRecorder {
	t.Helper()
	ch := postJSON(r, "/v1/auth/wallet/challenge", map[string]string{"address": s.address})
	if ch.Code != http.StatusOK {
		t.Fatalf("challenge: status %d body %s", ch.Code, ch.Body.String())
	}
	var challenge struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(ch.Body.Bytes(), &challenge); err != nil || challenge.Message == "" {
		t.Fatalf("challenge response has no message: %s", ch.Body.String())
	}
	sig := ed25519.Sign(s.priv, []byte(challenge.Message))
	return postJSON(r, "/v1/auth/wallet/login", map[string]string{
		"address":   s.address,
		"signature": base58.Encode(sig),
		"nonce":     challenge.Message,
	})
}

func responseCookie(w *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, c := range w.Result().Cookies() {
		if c.Name == name && c.MaxAge >= 0 && c.Value != "" {
			return c
		}
	}
	return nil
}

// Wallet login on the migrated schema, for a wallet the API has never seen and then for the
// same wallet again. The web app's sign-in depends on both.
func TestWalletLogin_NewWalletThenSameWalletAgain(t *testing.T) {
	r := authSessionRouter(t)
	testutil.CleanupTestData(t, "refresh_token_families", "linked_wallets", "wallets", "users")
	s := newWalletSigner(t)

	first := loginWithWallet(t, r, s)
	if first.Code != http.StatusOK {
		t.Fatalf("first login (new wallet): status %d body %s", first.Code, first.Body.String())
	}
	var firstResp struct {
		Token string `json:"token"`
		User  struct {
			ID            uuid.UUID `json:"id"`
			WalletAddress string    `json:"wallet_address"`
		} `json:"user"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &firstResp); err != nil || firstResp.Token == "" {
		t.Fatalf("first login returned no token: %s", first.Body.String())
	}
	if responseCookie(first, refreshTokenStorageKey) == nil {
		t.Fatalf("login did not set the %s cookie", refreshTokenStorageKey)
	}

	var profile models.User
	if err := db.DB.Where("wallet_address = ?", s.address).First(&profile).Error; err != nil {
		t.Fatalf("no profile for the wallet after login: %v", err)
	}
	var wallets int64
	db.DB.Model(&models.Wallet{}).Where("user_id = ?", profile.ID).Count(&wallets)
	if wallets != 1 {
		t.Fatalf("expected 1 custodial wallet row for the new user, got %d", wallets)
	}

	second := loginWithWallet(t, r, s)
	if second.Code != http.StatusOK {
		t.Fatalf("second login (existing wallet): status %d body %s", second.Code, second.Body.String())
	}
	var secondResp struct {
		User struct {
			ID uuid.UUID `json:"id"`
		} `json:"user"`
	}
	_ = json.Unmarshal(second.Body.Bytes(), &secondResp)
	if secondResp.User.ID != profile.ID {
		t.Fatalf("logging in again created a different user: %s vs %s", secondResp.User.ID, profile.ID)
	}
}

func TestRefresh_ValidCookieIssuesNewSession(t *testing.T) {
	r := authSessionRouter(t)
	testutil.CleanupTestData(t, "refresh_token_families", "linked_wallets", "wallets", "users")
	login := loginWithWallet(t, r, newWalletSigner(t))
	cookie := responseCookie(login, refreshTokenStorageKey)
	if cookie == nil {
		t.Fatalf("login set no refresh cookie: %s", login.Body.String())
	}

	w := postJSON(r, "/v1/auth/refresh", nil, cookie)
	if w.Code != http.StatusOK {
		t.Fatalf("refresh with a valid cookie: status %d body %s", w.Code, w.Body.String())
	}
	if responseCookie(w, refreshTokenStorageKey) == nil {
		t.Fatal("refresh did not rotate the cookie")
	}
}

// The web app sends a refresh token from localStorage in the body once, to migrate old
// sessions. When that token is stale, the valid HttpOnly cookie in the same request must still
// work: the stale token used to win and the user was signed out right after signing in.
func TestRefresh_StaleBodyTokenDoesNotBeatValidCookie(t *testing.T) {
	r := authSessionRouter(t)
	testutil.CleanupTestData(t, "refresh_token_families", "linked_wallets", "wallets", "users")
	login := loginWithWallet(t, r, newWalletSigner(t))
	cookie := responseCookie(login, refreshTokenStorageKey)
	if cookie == nil {
		t.Fatalf("login set no refresh cookie: %s", login.Body.String())
	}

	w := postJSON(r, "/v1/auth/refresh", map[string]string{"refresh_token": "stale-legacy-token-from-localstorage"}, cookie)
	if w.Code != http.StatusOK {
		t.Fatalf("stale body token + valid cookie: status %d body %s (want 200)", w.Code, w.Body.String())
	}
}

// A legacy cookie with the same name can sit next to the current HttpOnly one. Browsers send
// the older cookie first and Request.Cookie returns the first match, so only the stale value was
// ever read and every refresh failed.
func TestRefresh_FindsTheValidCookieAmongDuplicates(t *testing.T) {
	r := authSessionRouter(t)
	testutil.CleanupTestData(t, "refresh_token_families", "linked_wallets", "wallets", "users")
	login := loginWithWallet(t, r, newWalletSigner(t))
	valid := responseCookie(login, refreshTokenStorageKey)
	if valid == nil {
		t.Fatalf("login set no refresh cookie: %s", login.Body.String())
	}
	stale := &http.Cookie{Name: refreshTokenStorageKey, Value: "stale-legacy-cookie"}

	w := postJSON(r, "/v1/auth/refresh", nil, stale, valid)
	if w.Code != http.StatusOK {
		t.Fatalf("stale cookie listed before the valid one: status %d body %s (want 200)", w.Code, w.Body.String())
	}
}

func TestRefresh_RejectsMissingAndUnknownTokens(t *testing.T) {
	r := authSessionRouter(t)

	if w := postJSON(r, "/v1/auth/refresh", nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("no token: status %d, want 401", w.Code)
	}
	bad := &http.Cookie{Name: refreshTokenStorageKey, Value: "not-a-real-token"}
	w := postJSON(r, "/v1/auth/refresh", map[string]string{"refresh_token": "also-not-real"}, bad)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("only unknown tokens: status %d, want 401", w.Code)
	}
	if strings.Contains(w.Body.String(), "also-not-real") || strings.Contains(w.Body.String(), "not-a-real-token") {
		t.Fatalf("response echoes a submitted token: %s", w.Body.String())
	}
}

// A refresh token is still single use: presenting a rotated-out token revokes the session even
// when a stale body token or extra cookies are present.
func TestRefresh_RotatedTokenIsStillRejected(t *testing.T) {
	r := authSessionRouter(t)
	testutil.CleanupTestData(t, "refresh_token_families", "linked_wallets", "wallets", "users")
	login := loginWithWallet(t, r, newWalletSigner(t))
	old := responseCookie(login, refreshTokenStorageKey)
	if old == nil {
		t.Fatalf("login set no refresh cookie: %s", login.Body.String())
	}
	if w := postJSON(r, "/v1/auth/refresh", nil, old); w.Code != http.StatusOK {
		t.Fatalf("first refresh: status %d body %s", w.Code, w.Body.String())
	}
	if w := postJSON(r, "/v1/auth/refresh", nil, old); w.Code != http.StatusUnauthorized {
		t.Fatalf("reusing a rotated token: status %d, want 401", w.Code)
	}
}
