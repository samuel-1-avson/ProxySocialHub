package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestGetPublicSystemConfig_FallsBackToEnvTreasury(t *testing.T) {
	want := "TreasuryFallback1111111111111111111111111111111"
	t.Setenv("SOLANA_TREASURY_ADDRESS", want)

	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)

	cm := config.NewConfigManager(redis.Client, db.DB)
	if GetConfigManager() == nil {
		InitConfigManager(cm)
	}
	active := GetConfigManager()
	if active == nil {
		t.Fatal("config manager still nil after init")
	}
	// Empty DB/Redis value must fall back to SOLANA_TREASURY_ADDRESS.
	if err := active.Set("treasury_wallet_solana", "", "test empty treasury"); err != nil {
		t.Fatalf("set empty treasury config: %v", err)
	}

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/system/config/public", getPublicSystemConfig)

	req := httptest.NewRequest(http.MethodGet, "/system/config/public", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	got, _ := body["treasury_solana"].(string)
	if got != want {
		t.Fatalf("expected treasury fallback %q, got %q", want, got)
	}
	configured, _ := body["treasury_configured"].(bool)
	if !configured {
		t.Fatal("expected treasury_configured=true when env is set")
	}
}

func TestGetPublicSystemConfig_ListingCommitmentObserveHonesty(t *testing.T) {
	t.Setenv("PROXYHUB_LISTING_COMMITMENT", "observe")
	t.Setenv("PROXYHUB_LISTING_BUNDLE_PATH", "")
	t.Setenv("PROXYHUB_LISTING_BUNDLE_URL", "")
	t.Setenv("PROXYHUB_LISTING_BUNDLE_CID", "")

	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)

	cm := config.NewConfigManager(redis.Client, db.DB)
	if GetConfigManager() == nil {
		InitConfigManager(cm)
	}

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/system/config/public", getPublicSystemConfig)

	req := httptest.NewRequest(http.MethodGet, "/system/config/public", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	disc, _ := body["discovery"].(map[string]interface{})
	if disc == nil {
		t.Fatalf("missing discovery: %s", w.Body.String())
	}
	if got, _ := disc["listing_commitment_mode"].(string); got != "observe" {
		t.Fatalf("listing_commitment_mode=%q", got)
	}
	if got, _ := disc["listing_commitments"].(string); got != "ed25519_offer_hash+listing_commitment_pda" {
		t.Fatalf("listing_commitments=%q", got)
	}
	if got, _ := disc["catalog_source"].(string); got != "postgres" {
		t.Fatalf("catalog_source=%q (must stay postgres; not a catalog)", got)
	}
	if got, _ := disc["delist_authority"].(string); got != "platform_moderation" {
		t.Fatalf("delist_authority=%q", got)
	}
}
