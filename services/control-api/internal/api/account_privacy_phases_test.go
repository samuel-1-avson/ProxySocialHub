package api

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/authstate"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAccountPrivacyManagedClosureRequiresFreshLinkedIdentityAndCanCancel(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	u := testutil.CreateTestUser(t, testutil.UniqueEmail("closure-google"), "buyer")
	if err := db.DB.Model(&models.Wallet{}).Where("user_id = ?", u.ID).Updates(map[string]interface{}{"balance_sol": 0, "balance_lamports": 0, "earnings_payable_lamports": 0}).Error; err != nil {
		t.Fatal(err)
	}
	subject := uuid.NewString()
	if err := db.DB.Create(&models.UserIdentity{ID: uuid.New(), UserID: u.ID, Provider: models.IdentityProviderGoogle, Subject: subject}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.DB.Create(&models.EmbeddedWallet{ID: uuid.New(), UserID: u.ID, Chain: "solana", Address: uuid.NewString(), SealedKey: []byte("synthetic-sealed-key"), WrappedDEK: []byte("synthetic-wrapped-key"), KEKID: "synthetic-test"}).Error; err != nil {
		t.Fatal(err)
	}
	original := verifyGoogleToken
	t.Cleanup(func() { verifyGoogleToken = original })
	verifyGoogleToken = func(_ context.Context, credential, _ string) (googleIdentity, error) {
		identity := googleIdentity{Subject: subject, EmailVerified: true, IssuedAt: time.Now().Unix()}
		if credential == "wrong" {
			identity.Subject = "another-account"
		}
		if credential == "stale" {
			identity.IssuedAt = time.Now().Add(-time.Hour).Unix()
		}
		return identity, nil
	}
	r := f02RouterAs(u.ID)
	r.DELETE("/delete", deleteAccount)
	r.POST("/cancel", cancelDeletion)
	for _, credential := range []string{"wrong", "stale"} {
		body, _ := json.Marshal(gin.H{"confirmation": "DELETE MY ACCOUNT", "google_credential": credential})
		if w := privacyRequest(r, "DELETE", "/delete", string(body)); w.Code != 403 {
			t.Fatal("invalid reauthentication accepted", w.Code, w.Body.String())
		}
	}
	body, _ := json.Marshal(gin.H{"confirmation": "DELETE MY ACCOUNT", "google_credential": "fresh"})
	if w := privacyRequest(r, "DELETE", "/delete", string(body)); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if err := db.DB.First(u, "id = ?", u.ID).Error; err != nil {
		t.Fatal(err)
	}
	if u.ScheduledDeletionAt == nil || u.ProfilePublic || u.MapVisible || u.ContactMode != "nobody" {
		t.Fatal("closure was not scheduled privately")
	}
	if w := privacyRequest(r, "POST", "/cancel", `{}`); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var after models.User
	if err := db.DB.First(&after, "id = ?", u.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.ScheduledDeletionAt != nil || after.ProfilePublic {
		t.Fatal("cancellation changed visibility or failed")
	}
}

func privacyRequest(r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestAccountPrivacyDefaultsAndExplicitConsent(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	u := models.User{ID: uuid.New(), Email: testutil.UniqueEmail("privacy-default"), Role: "buyer"}
	if err := db.DB.Create(&u).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.DB.First(&u, "id = ?", u.ID).Error; err != nil {
		t.Fatal(err)
	}
	p := privacyFrom(u)
	if p.ProfilePublic || p.Discoverable || p.MapVisible || p.PresenceVisible || p.ActivityPublic || p.AnalyticsOptIn || p.AllowDirectConnections || p.PublicChainConsent || p.ContactMode != "contacts" || p.MapPrecision != "country" {
		t.Fatalf("unsafe defaults: %+v", p)
	}
	r := f02RouterAs(u.ID)
	r.PUT("/privacy", updatePrivacySettings)
	r.GET("/preview", previewPrivacy)
	for _, body := range []string{`{"allow_direct_connections":true}`, `{"public_chain_consent":true}`, `{"map_precision":"exact"}`, `{"profile_public":true,"unknown":1}`, `{} {}`} {
		if w := privacyRequest(r, "PUT", "/privacy", body); w.Code != 400 {
			t.Fatalf("accepted %s: %d %s", body, w.Code, w.Body.String())
		}
	}
	w := privacyRequest(r, "PUT", "/privacy", `{"profile_public":true,"map_visible":true,"allow_direct_connections":true,"acknowledge_ip_disclosure":true}`)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w = privacyRequest(r, "PUT", "/privacy", `{"profile_public":false,"map_visible":false,"allow_direct_connections":false}`)
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(w.Code, w.Body.String())
	}
	db.DB.First(&u, "id = ?", u.ID)
	if u.ProfilePublic || u.MapVisible || u.AllowDirectConnections {
		t.Fatal("false values did not persist")
	}
}

func TestAccountPrivacySessionRevocationAndBan(t *testing.T) {
	testutil.SetupTestDB(t)
	u := testutil.CreateTestUser(t, testutil.UniqueEmail("privacy-session"), "buyer")
	s, err := issueRequestAuthSession(nil, *u, "local-session-regression-secret-123456789")
	if err != nil {
		t.Fatal(err)
	}
	claims, err := crypto.ValidateToken(s.Token, "local-session-regression-secret-123456789")
	if err != nil {
		t.Fatal(err)
	}
	if claims.Email != "" || claims.Wallet != "" || claims.SessionID == "" {
		t.Fatal("JWT contains PII or lacks session binding")
	}
	if _, err := authstate.Validate(u.ID.String(), claims.SessionID, true); err != nil {
		t.Fatal(err)
	}
	if err := revokeAuthFamily(db.DB, claims.SessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := authstate.Validate(u.ID.String(), claims.SessionID, true); err == nil {
		t.Fatal("revoked JWT remained authorized")
	}
	s, err = issueRequestAuthSession(nil, *u, "local-session-regression-secret-123456789")
	if err != nil {
		t.Fatal(err)
	}
	claims, _ = crypto.ValidateToken(s.Token, "local-session-regression-secret-123456789")
	db.DB.Model(&models.User{}).Where("id = ?", u.ID).Update("status", "banned")
	if _, err := authstate.Validate(u.ID.String(), claims.SessionID, true); err == nil {
		t.Fatal("banned account remained authorized")
	}
}

func TestAccountPrivacyMFAChallengeIsNotASessionAndConsumesBackupCode(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	u := testutil.CreateTestUser(t, testutil.UniqueEmail("privacy-mfa"), "buyer")
	codes, hashes, err := mfaService.GenerateBackupCodes(2)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(hashes)
	settings := models.UserSettings{UserID: u.ID, TwoFactorEnabled: true, TwoFactorSecret: "JBSWY3DPEHPK3PXP", TwoFactorBackupCodes: string(encoded)}
	if err := db.DB.Create(&settings).Error; err != nil {
		t.Fatal(err)
	}
	secret, err := requireJWTSecret()
	if err != nil {
		t.Fatal(err)
	}
	r := f02RouterAs(u.ID)
	r.POST("/login", func(c *gin.Context) { completeLoginOrChallenge(c, *u, secret) })
	r.POST("/verify", verifyMFALogin)
	r.POST("/setup", setupMFA)
	w := privacyRequest(r, "POST", "/login", `{}`)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var ch struct {
		Challenge string `json:"challenge_token"`
		Required  bool   `json:"mfa_required"`
		Token     string `json:"token"`
	}
	json.Unmarshal(w.Body.Bytes(), &ch)
	if !ch.Required || ch.Challenge == "" || ch.Token != "" || len(w.Result().Cookies()) != 0 {
		t.Fatal("primary login bypassed MFA")
	}
	if n := f02Count(t, &models.UserSession{}, "user_id = ?", u.ID); n != 0 {
		t.Fatal("challenge created a session")
	}
	body, _ := json.Marshal(gin.H{"challenge_token": ch.Challenge, "code": codes[0]})
	w = privacyRequest(r, "POST", "/verify", string(body))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"token"`) {
		t.Fatal(w.Code, w.Body.String())
	}
	if w = privacyRequest(r, "POST", "/verify", string(body)); w.Code != 401 {
		t.Fatal("challenge replay accepted", w.Body.String())
	}
	if w = privacyRequest(r, "POST", "/setup", `{}`); w.Code != 409 {
		t.Fatal("enabled factor could be replaced", w.Code, w.Body.String())
	}
	if err := db.DB.First(&settings, "id = ?", settings.ID).Error; err != nil {
		t.Fatal(err)
	}
	if verifyFactor(&settings, codes[0]) {
		t.Fatal("backup code reused")
	}
}

func TestAccountPrivacyContactsAndMapPrecision(t *testing.T) {
	testutil.SetupTestDB(t)
	a := testutil.CreateTestUser(t, testutil.UniqueEmail("privacy-a"), "buyer")
	b := testutil.CreateTestUser(t, testutil.UniqueEmail("privacy-b"), "provider")
	db.DB.Model(b).Update("contact_mode", "contacts")
	if ok, err := contactAllowed(a.ID, b.ID, nil, nil); err != nil || ok {
		t.Fatal("stranger contact allowed", err)
	}
	if err := db.DB.Create(&models.Friendship{UserID: a.ID, FriendID: b.ID}).Error; err != nil {
		t.Fatal(err)
	}
	if ok, err := contactAllowed(a.ID, b.ID, nil, nil); err != nil || !ok {
		t.Fatal("approved contact rejected", err)
	}
	db.DB.Model(b).Update("contact_mode", "nobody")
	if ok, _ := contactAllowed(a.ID, b.ID, nil, nil); ok {
		t.Fatal("nobody mode bypassed")
	}
	a1, b1, source := publicMapCoords(5.603712, -0.186964, "GH", "Accra", "Greater Accra", "secret", "country")
	a2, b2, _ := publicMapCoords(9.5, -1.7, "GH", "Tamale", "Northern", "other", "country")
	if a1 != a2 || b1 != b2 || source != "country_centroid" {
		t.Fatal("country pins depend on exact location")
	}
	if x, y, source := publicMapCoords(12.345, 67.89, "unknown", "", "", "secret", "country"); x != 0 || y != 0 || source != "unknown" {
		t.Fatal("unknown location fell back to exact coordinates")
	}
}

func TestAccountPrivacyExportHasCheckedInventoryAndNoSecrets(t *testing.T) {
	testutil.SetupTestDB(t)
	if exportHasSecrets() {
		t.Fatal("secret column in export inventory")
	}
	u := testutil.CreateTestUser(t, testutil.UniqueEmail("privacy-export"), "buyer")
	r := f02RouterAs(u.ID)
	r.GET("/export", requestDataExport)
	w := privacyRequest(r, "GET", "/export", "")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	zr, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, f := range zr.File {
		found[f.Name] = true
		rc, _ := f.Open()
		body, _ := io.ReadAll(rc)
		rc.Close()
		for _, secret := range []string{`"two_factor_secret"`, `"sealed_key"`, `"credentials_pass"`, `"refresh_token"`} {
			if strings.Contains(string(body), secret) {
				t.Fatal("export secret", f.Name, secret)
			}
		}
	}
	if !found["manifest.json"] || !found["account.json"] || !found["messages.jsonl"] || !found["audit_logs.jsonl"] {
		t.Fatal("missing export classes", found)
	}
}

func TestAccountPrivacyP2PRejectsGuestsAndDisabledSignaling(t *testing.T) {
	t.Setenv("P2P_SIGNALING_ENABLED", "true")
	r := setupTestRouter()
	r.GET("/signal/:sessionId", handleGetP2PSignals)
	if w := privacyRequest(r, "GET", "/signal/"+uuid.NewString(), ""); w.Code != 401 {
		t.Fatal(w.Code, w.Body.String())
	}
	t.Setenv("P2P_SIGNALING_ENABLED", "false")
	r = f02RouterAs(uuid.New())
	r.GET("/signal/:sessionId", handleGetP2PSignals)
	if w := privacyRequest(r, "GET", "/signal/"+uuid.NewString(), ""); w.Code != 403 {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestAccountPrivacyP2POwnershipConsentAndLimits(t *testing.T) {
	testutil.SetupTestDB(t)
	t.Setenv("P2P_SIGNALING_ENABLED", "true")
	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("p2p-buyer"), "buyer")
	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("p2p-seller"), "provider")
	listing := testutil.CreateTestListing(t, seller.ID)
	until := time.Now().Add(time.Hour)
	session := models.Session{UserID: buyer.ID, ListingID: &listing.ID, Type: models.SessionSticky, Status: models.SessionActive, ExpiresAt: &until, CredentialsUser: uuid.NewString(), CredentialsPass: "synthetic-credential"}
	if err := db.DB.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	order := models.Order{BuyerID: buyer.ID, SellerID: seller.ID, ListingID: listing.ID, SessionID: &session.ID, Status: models.OrderStatusActive, BandwidthGB: 1, PricePerGB: 1, TotalPrice: 1}
	if err := db.DB.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	r := f02RouterAs(buyer.ID)
	r.POST("/offer", handlePostP2POffer)
	r.POST("/answer", handlePostP2PAnswer)
	body := `{"session_id":"` + session.ID.String() + `","offer_sdp":"synthetic-offer","buyer_pubkey":"spoofed","ice_candidates":["synthetic-candidate"]}`
	if w := privacyRequest(r, "POST", "/offer", body); w.Code != 403 {
		t.Fatal("missing consent accepted", w.Code, w.Body.String())
	}
	if err := db.DB.Model(&models.User{}).Where("id IN ?", []uuid.UUID{buyer.ID, seller.ID}).Update("allow_direct_connections", true).Error; err != nil {
		t.Fatal(err)
	}
	if w := privacyRequest(r, "POST", "/offer", body); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	answer := `{"session_id":"` + session.ID.String() + `","answer_sdp":"synthetic-answer"}`
	if w := privacyRequest(r, "POST", "/answer", answer); w.Code != 403 {
		t.Fatal("buyer wrote provider answer", w.Code)
	}
	outsider := f02RouterAs(uuid.New())
	outsider.GET("/signal/:sessionId", handleGetP2PSignals)
	if w := privacyRequest(outsider, "GET", "/signal/"+session.ID.String(), ""); w.Code != 403 {
		t.Fatal("unrelated account read signaling", w.Code)
	}
	provider := f02RouterAs(seller.ID)
	provider.POST("/answer", handlePostP2PAnswer)
	provider.GET("/signal/:sessionId", handleGetP2PSignals)
	if w := privacyRequest(provider, "POST", "/answer", answer); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := privacyRequest(provider, "GET", "/signal/"+session.ID.String(), ""); w.Code != 200 || strings.Contains(w.Body.String(), "spoofed") {
		t.Fatal("untrusted identity or missing signal", w.Code, w.Body.String())
	}
	oversized := `{"session_id":"` + session.ID.String() + `","offer_sdp":"` + strings.Repeat("a", 32769) + `"}`
	if w := privacyRequest(r, "POST", "/offer", oversized); w.Code != 400 {
		t.Fatal("oversized SDP accepted")
	}
	f02Block(t, buyer, seller)
	if w := privacyRequest(provider, "GET", "/signal/"+session.ID.String(), ""); w.Code != 403 {
		t.Fatal("blocked peer read signaling")
	}
	globalSignalingStore.mu.Lock()
	delete(globalSignalingStore.sessions, session.ID.String())
	globalSignalingStore.mu.Unlock()
}
