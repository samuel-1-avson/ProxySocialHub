package api

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestDevListingServerSignEnabled(t *testing.T) {
	t.Setenv("PROXYHUB_ALLOW_DEV_LISTING_SIGN", "")
	t.Setenv("PROXYHUB_PROVIDER_SIGNING_KEY", "")
	t.Setenv("GIN_MODE", "release")
	t.Setenv("APP_ENV", "production")
	if devListingServerSignEnabled() {
		t.Fatal("expected disabled in production without explicit allow")
	}

	t.Setenv("PROXYHUB_ALLOW_DEV_LISTING_SIGN", "true")
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(i + 3)
	}
	t.Setenv("PROXYHUB_PROVIDER_SIGNING_KEY", base58.Encode(seed))
	if !devListingServerSignEnabled() {
		t.Fatal("expected enabled when allow flag and signing key are set")
	}
}

func TestGetListingProofPolicy_DevServerSigning(t *testing.T) {
	t.Setenv("PROVIDER_SIGNATURE_MODE", "enforce")
	t.Setenv("PROXYHUB_ALLOW_DEV_LISTING_SIGN", "true")
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(i + 7)
	}
	t.Setenv("PROXYHUB_PROVIDER_SIGNING_KEY", base58.Encode(seed))

	r := gin.New()
	r.GET("/listings/proof-policy", getListingProofPolicy)

	req := httptest.NewRequest(http.MethodGet, "/listings/proof-policy", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["dev_server_signing"] != true {
		t.Fatalf("expected dev_server_signing true, got %+v", body)
	}
}

func TestSignListingOfferDev_ReturnsProof(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes", "proxy_listings")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("devsign"), "provider")
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(i + 11)
	}
	priv := ed25519.NewKeyFromSeed(seed)
	pubB58 := base58.Encode(priv.Public().(ed25519.PublicKey))

	nodeID := uuid.New()
	pn := models.ProviderNode{
		ID:            nodeID,
		UserID:        user.ID,
		Name:          "Dev Sign Node",
		GatewayNodeID: providerGatewayNodeID(user.ID),
		Hotkey:        pubB58,
		Status:        models.NodeOnline,
	}
	if err := db.DB.Create(&pn).Error; err != nil {
		t.Fatal(err)
	}

	t.Setenv("PROXYHUB_ALLOW_DEV_LISTING_SIGN", "true")
	t.Setenv("PROXYHUB_PROVIDER_SIGNING_KEY", base58.Encode(seed))
	t.Setenv("GIN_MODE", "test")

	body := map[string]any{
		"title":                  "Signed dev listing title",
		"description":            "Dev server signed offer",
		"provider_node_id":       nodeID.String(),
		"proxy_type":             "residential",
		"protocol":               "http",
		"price_per_gb":           1.25,
		"available_bandwidth_gb": 50,
		"max_concurrency":        5,
	}
	raw, _ := json.Marshal(body)

	r := gin.New()
	r.POST("/provider/listings/sign-offer", func(c *gin.Context) {
		c.Set("user_id", user.ID)
		signListingOfferDev(c)
	})

	req := httptest.NewRequest(http.MethodPost, "/provider/listings/sign-offer", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}

	var resp struct {
		Proof models.ProviderProof `json:"proof"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Proof.Signature == "" || resp.Proof.PayloadHash == "" {
		t.Fatalf("incomplete proof: %+v", resp.Proof)
	}
	if resp.Proof.ProviderHotkey != pubB58 {
		t.Fatalf("expected hotkey %s, got %s", pubB58, resp.Proof.ProviderHotkey)
	}
}
