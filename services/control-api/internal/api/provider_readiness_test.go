package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestProviderReadiness_EmptyProviderNeedsToken(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_tokens", "provider_nodes", "proxy_listings")
	t.Setenv("PROVIDER_SIGNATURE_MODE", "observe")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("provider-readiness-empty"), "provider")

	r := providerReadinessTestRouter(user.ID)
	req := httptest.NewRequest(http.MethodGet, "/provider/readiness", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body %s", w.Code, w.Body.String())
	}

	var resp providerReadinessResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode readiness: %v", err)
	}
	if resp.Status != readinessActionRequired {
		t.Fatalf("status = %s, want %s", resp.Status, readinessActionRequired)
	}
	if resp.Next == nil || resp.Next.CheckID != "api_token" {
		t.Fatalf("next = %#v, want api_token", resp.Next)
	}
	if resp.Summary.ReadyForTraffic {
		t.Fatal("empty provider should not be ready for traffic")
	}
}

func TestProviderReadiness_ReadyForTrafficWithWarnings(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_tokens", "provider_nodes", "proxy_listings")
	t.Setenv("PROVIDER_SIGNATURE_MODE", "observe")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("provider-readiness-ready"), "provider")
	createReadinessToken(t, user.ID)

	now := time.Now().UTC()
	nodeID := uuid.New()
	node := models.ProviderNode{
		ID:            nodeID,
		UserID:        user.ID,
		Name:          "Ready Node",
		Status:        models.NodeOnline,
		LastSeenAt:    &now,
		GatewayNodeID: "node_" + user.ID.String(),
	}
	if err := db.DB.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	listing := models.ProxyListing{
		ID:                   uuid.New(),
		SellerID:             user.ID,
		ProviderNodeID:       &nodeID,
		Title:                "Ready Listing",
		Description:          "test",
		PricePerGB:           0.1,
		AvailableBandwidthGB: 10,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("create listing: %v", err)
	}

	r := providerReadinessTestRouter(user.ID)
	req := httptest.NewRequest(http.MethodGet, "/provider/readiness", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body %s", w.Code, w.Body.String())
	}

	var resp providerReadinessResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode readiness: %v", err)
	}
	if resp.Status != readinessAttention {
		t.Fatalf("status = %s, want %s because proof/payout are warnings", resp.Status, readinessAttention)
	}
	if !resp.Summary.ReadyForTraffic {
		t.Fatal("expected ready_for_traffic")
	}
	if !resp.Summary.ReadyForMarketplace {
		t.Fatal("expected ready_for_marketplace")
	}
	if resp.Summary.ReadyForPayouts {
		t.Fatal("expected payout readiness warning until wallet is linked")
	}
	if got := readinessCheckStatus(resp.Checks, "heartbeat_proof"); got != readinessAttention {
		t.Fatalf("heartbeat_proof status = %s, want attention", got)
	}
}

func TestProviderReadiness_ProofBlocksInEnforceMode(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_tokens", "provider_nodes", "proxy_listings")
	t.Setenv("PROVIDER_SIGNATURE_MODE", "enforce")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("provider-readiness-enforce"), "provider")
	createReadinessToken(t, user.ID)
	now := time.Now().UTC()
	node := models.ProviderNode{
		ID:            uuid.New(),
		UserID:        user.ID,
		Name:          "Unsigned Node",
		Status:        models.NodeOnline,
		LastSeenAt:    &now,
		GatewayNodeID: "node_" + user.ID.String(),
	}
	if err := db.DB.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	r := providerReadinessTestRouter(user.ID)
	req := httptest.NewRequest(http.MethodGet, "/provider/readiness", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	var resp providerReadinessResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode readiness: %v", err)
	}
	if got := readinessCheckStatus(resp.Checks, "heartbeat_proof"); got != readinessActionRequired {
		t.Fatalf("heartbeat_proof status = %s, want action_required", got)
	}
}

func providerReadinessTestRouter(userID uuid.UUID) *gin.Engine {
	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	})
	r.GET("/provider/readiness", getProviderReadiness)
	return r
}

func createReadinessToken(t *testing.T, userID uuid.UUID) {
	t.Helper()
	expiresAt := time.Now().Add(24 * time.Hour)
	token := models.ProviderToken{
		ID:        uuid.New(),
		UserID:    userID,
		Token:     uuid.NewString(),
		Name:      "readiness-token",
		IsActive:  true,
		ExpiresAt: &expiresAt,
	}
	if err := db.DB.Create(&token).Error; err != nil {
		t.Fatalf("create token: %v", err)
	}
}

func readinessCheckStatus(checks []providerReadinessCheck, id string) string {
	for _, check := range checks {
		if check.ID == id {
			return check.Status
		}
	}
	return ""
}
