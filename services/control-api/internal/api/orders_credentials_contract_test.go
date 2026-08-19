package api

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/proofs"
)

func testCapabilitySigningSeed(t *testing.T) string {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate signing key: %v", err)
	}
	return base58.Encode(priv.Seed())
}

func TestCredentials_PublishedPasswordIsHMAC(t *testing.T) {
	session := &models.Session{
		CredentialsUser: "buyer-cred-user",
		CredentialsPass: "hmac-secret-not-capability",
	}
	creds := buildProxyCredentialsResponse(session)
	pass, _ := creds["password"].(string)
	legacy, _ := creds["legacy_password"].(string)
	auth, _ := creds["auth_for_endpoint"].(string)
	if pass != session.CredentialsPass {
		t.Fatalf("password=%q want HMAC %q", pass, session.CredentialsPass)
	}
	if legacy != pass {
		t.Fatalf("legacy_password=%q want same as password %q", legacy, pass)
	}
	if auth != publishedBuyerAuthHMAC {
		t.Fatalf("auth_for_endpoint=%q want %q", auth, publishedBuyerAuthHMAC)
	}
	if proofs.LooksLikeSessionCapabilityToken(pass) {
		t.Fatal("published password must not be a phubb1. capability token")
	}
	if _, ok := creds["expires_at"]; ok {
		t.Fatal("expires_at must be omitted when session.ExpiresAt is unset")
	}
}

func TestCredentials_IncludesSessionExpiresAt(t *testing.T) {
	exp := time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)
	session := &models.Session{
		CredentialsUser: "buyer-cred-user",
		CredentialsPass: "hmac-secret-not-capability",
		ExpiresAt:       &exp,
	}
	creds := buildProxyCredentialsResponse(session)
	got, _ := creds["expires_at"].(string)
	if got != "2026-08-20T12:00:00Z" {
		t.Fatalf("expires_at=%q want RFC3339 UTC", got)
	}
	pass, _ := creds["password"].(string)
	if pass != session.CredentialsPass {
		t.Fatalf("password=%q want HMAC (expires_at must not change the HMAC contract)", pass)
	}
}

func TestGetOrderCredentials_EnforceKeepsHMACPassword(t *testing.T) {
	t.Setenv("PROXYHUB_SESSION_CAPABILITY", "enforce")
	t.Setenv("PROXYHUB_SESSION_CAPABILITY_SIGNING_KEY", testCapabilitySigningSeed(t))

	fx := purchaseActivateAndFetchCredentials(t)

	var credResp struct {
		ProxyCredentials  map[string]interface{} `json:"proxy_credentials"`
		SessionCapability string                 `json:"session_capability"`
		SessionCapError   string                 `json:"session_capability_error"`
	}
	if err := json.Unmarshal(fx.credBody, &credResp); err != nil {
		t.Fatalf("decode credentials: %v", err)
	}
	if credResp.SessionCapError != "" {
		t.Fatalf("capability mint error: %s", credResp.SessionCapError)
	}
	if !strings.HasPrefix(credResp.SessionCapability, proofs.SessionCapabilityTokenPrefix) {
		t.Fatalf("session_capability=%q want %s prefix", credResp.SessionCapability, proofs.SessionCapabilityTokenPrefix)
	}

	pass, _ := credResp.ProxyCredentials["password"].(string)
	legacy, _ := credResp.ProxyCredentials["legacy_password"].(string)
	auth, _ := credResp.ProxyCredentials["auth_for_endpoint"].(string)
	if pass != fx.session.CredentialsPass {
		t.Fatalf("password=%q want session HMAC %q", pass, fx.session.CredentialsPass)
	}
	if proofs.LooksLikeSessionCapabilityToken(pass) {
		t.Fatal("enforce must not put phubb1. in proxy_credentials.password (public :8090 is HMAC)")
	}
	if legacy != pass {
		t.Fatalf("legacy_password=%q want HMAC alias %q", legacy, pass)
	}
	if auth != publishedBuyerAuthHMAC {
		t.Fatalf("auth_for_endpoint=%q want %q", auth, publishedBuyerAuthHMAC)
	}
}
