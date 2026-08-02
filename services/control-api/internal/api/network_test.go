package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// API-01/FE-05 regression: /v1/network/status must be registered publicly
// (mounted on the unauthenticated /v1 group in main.go) and fail safely without DB.
func TestNetworkStatusRouteRegisteredAndSafeWithoutDB(t *testing.T) {
	prev := db.DB
	db.DB = nil
	defer func() { db.DB = prev }()

	r := setupTestRouter()
	RegisterNetworkRoutes(r.Group("/"))

	req := httptest.NewRequest(http.MethodGet, "/network/status", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code == http.StatusNotFound {
		t.Fatal("/network/status is not registered")
	}
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 without DB, got %d", w.Code)
	}
}

// Verifies the aggregate payload shape consumed by the analytics dashboard.
// Skips when TEST_DATABASE_URL is unavailable (standard suite behavior).
func TestNetworkStatusAggregates(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "nodes", "users")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("netstatus"), "provider")

	healthy := models.Node{
		ID:             uuid.New(),
		UserID:         provider.ID,
		ProviderUserID: provider.ID,
		CountryCode:    "US",
		Region:         "us-east",
		IsHealthy:      true,
		LatencyMs:      50,
		QualityScore:   91.5,
	}
	unhealthy := models.Node{
		ID:             uuid.New(),
		UserID:         provider.ID,
		ProviderUserID: provider.ID,
		CountryCode:    "DE",
		Region:         "eu-central",
		IsHealthy:      false,
		LatencyMs:      400,
		QualityScore:   10,
	}
	if err := db.DB.Create(&healthy).Error; err != nil {
		t.Fatalf("create healthy node: %v", err)
	}
	if err := db.DB.Create(&unhealthy).Error; err != nil {
		t.Fatalf("create unhealthy node: %v", err)
	}

	r := setupTestRouter()
	RegisterNetworkRoutes(r.Group("/"))
	req := httptest.NewRequest(http.MethodGet, "/network/status", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		TotalNodes   int64   `json:"total_nodes"`
		HealthyNodes int64   `json:"healthy_nodes"`
		AvgLatency   float64 `json:"avg_latency"`
		TopCountries []string `json:"top_countries"`
		NodeScores   []struct {
			ID      string  `json:"id"`
			Country string  `json:"country"`
			Region  string  `json:"region"`
			Score   float64 `json:"score"`
		} `json:"node_scores"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if resp.TotalNodes != 2 || resp.HealthyNodes != 1 {
		t.Fatalf("expected total=2 healthy=1, got total=%d healthy=%d", resp.TotalNodes, resp.HealthyNodes)
	}
	if resp.AvgLatency != 50 {
		t.Fatalf("expected avg_latency=50 (healthy nodes only), got %v", resp.AvgLatency)
	}
	// Both countries have one node each — assert presence, not order (tie).
	countrySet := map[string]bool{}
	for _, cc := range resp.TopCountries {
		countrySet[cc] = true
	}
	if !countrySet["US"] || !countrySet["DE"] {
		t.Fatalf("expected US and DE in top_countries, got %v", resp.TopCountries)
	}
	if len(resp.NodeScores) != 1 || resp.NodeScores[0].Country != "US" || resp.NodeScores[0].Score != 91.5 {
		t.Fatalf("expected only the healthy node in node_scores, got %+v", resp.NodeScores)
	}
}
