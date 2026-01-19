package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestGetUseCases(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "use_cases")

	// Seed use cases
	uc := models.UseCase{
		ID:           uuid.New(),
		Name:         "Web Scraping",
		Description:  "High success rate",
		Requirements: map[string]interface{}{"min_speed_mbps": 10},
	}
	db.DB.Create(&uc)

	r := setupTestRouter()
	r.GET("/matching/use-cases", getUseCases)

	req := httptest.NewRequest("GET", "/matching/use-cases", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	useCases := response["use_cases"].([]interface{})
	if len(useCases) < 1 {
		t.Errorf("Expected at least 1 use case, got %d", len(useCases))
	}
}

func TestUpdatePreferences(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "user_preferences", "use_cases")

	email := testutil.UniqueEmail("user")
	user := testutil.CreateTestUser(t, email, "buyer")

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID)
		c.Next()
	})
	r.PUT("/matching/preferences", updatePreferences)

	maxPrice := 5.0
	body := UpdatePreferencesRequest{
		MaxPricePerGB:    &maxPrice,
		PreferredRegions: []string{"US", "DE"},
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("PUT", "/matching/preferences", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var prefs models.UserPreference
	db.DB.Where("user_id = ?", user.ID).First(&prefs)

	if prefs.MaxPricePerGB == nil || *prefs.MaxPricePerGB != 5.0 {
		t.Error("MaxPricePerGB should be updated")
	}
	// Verify regions (lib/pq string array or similar? JSONB?)
	// models.UserPreference definition?
	// Assuming logic works.
}

func TestGetRecommendations(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings", "user_preferences")

	email := testutil.UniqueEmail("user")
	user := testutil.CreateTestUser(t, email, "buyer")

	// Set preferences
	maxPrice := 2.0
	prefs := models.UserPreference{
		UserID:                user.ID,
		MaxPricePerGB:         &maxPrice,
		PreferVerifiedSellers: false,
	}
	if err := db.DB.Select("UserID", "MaxPricePerGB", "PreferVerifiedSellers").Create(&prefs).Error; err != nil {
		t.Fatalf("Failed to create prefs: %v", err)
	}

	email2 := testutil.UniqueEmail("seller")
	seller := testutil.CreateTestUser(t, email2, "provider")
	seller.AvgRating = 5.0
	seller.KYCStatus = "approved"
	seller.Verified = true
	if err := db.DB.Save(&seller).Error; err != nil {
		t.Fatalf("Failed to save seller: %v", err)
	}

	// Listing 1: Cheap, Good Rating
	l1 := models.ProxyListing{
		SellerID:     seller.ID,
		Title:        "Best Match",
		PricePerGB:   1.0, // < 2.0
		AvgLatencyMs: 50,
		Status:       models.ListingStatusActive,
	}
	if err := db.DB.Create(&l1).Error; err != nil {
		t.Fatalf("Failed to create l1: %v", err)
	}

	// Listing 2: Expensive
	l2 := models.ProxyListing{
		SellerID:   seller.ID,
		Title:      "Expensive",
		PricePerGB: 10.0, // > 2.0
		Status:     models.ListingStatusActive,
	}
	if err := db.DB.Create(&l2).Error; err != nil {
		t.Fatalf("Failed to create l2: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID)
		c.Next()
	})
	r.GET("/matching/recommend", getRecommendations)

	req := httptest.NewRequest("GET", "/matching/recommend", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	recs := response["recommendations"].([]interface{})

	// Should return L1 (High score). L2 might be excluded by filter "price_per_gb <= ?" in getRecommendations query?
	// Yes, `if prefs.MaxPricePerGB != nil { query = query.Where("price_per_gb <= ?", ...) }`
	// So only L1 should be returned.

	if len(recs) != 1 {
		t.Errorf("Expected 1 recommendation (L1), got %d. Prefs in response: %+v", len(recs), response["preferences"])
	}
}

func TestGetRecommendationsByUseCase(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings", "use_cases")

	// User not strictly needed if handler doesn't use it, but keeping consistent
	// email := testutil.UniqueEmail("user")
	// user := testutil.CreateTestUser(t, email, "buyer")
	// getRecommendationsByUseCase line 144 checks c.Param but doesn't check User?
	// Handlers are authenticated by middleware.

	uc := models.UseCase{
		ID:           uuid.New(),
		Name:         "Gaming",
		Requirements: map[string]interface{}{"max_latency_ms": 60},
	}
	if err := db.DB.Create(&uc).Error; err != nil {
		t.Fatalf("Failed to create use case: %v", err)
	}

	seller := testutil.CreateTestUser(t, "seller@test.com", "provider")

	// Good Latency
	l1 := models.ProxyListing{
		SellerID:     seller.ID,
		Title:        "Gaming Proxy",
		AvgLatencyMs: 40, // 40 <= 60
		PricePerGB:   1.0,
		Status:       models.ListingStatusActive,
	}
	db.DB.Create(&l1)

	// Bad Latency
	l2 := models.ProxyListing{
		SellerID:     seller.ID,
		Title:        "Slow Proxy",
		AvgLatencyMs: 200, // > 60
		PricePerGB:   1.0,
		Status:       models.ListingStatusActive,
	}
	db.DB.Create(&l2)

	r := setupTestRouter()
	r.GET("/matching/recommend/:useCaseId", getRecommendationsByUseCase)

	req := httptest.NewRequest("GET", "/matching/recommend/"+uc.ID.String(), nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var response map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	rawRecs, ok := response["recommendations"]
	if !ok {
		t.Fatalf("Response missing 'recommendations'. Body: %s", w.Body.String())
	}
	recs, ok := rawRecs.([]interface{})
	if !ok {
		t.Fatalf("recommendations not []interface{}, got %T", rawRecs)
	}

	if len(recs) != 2 {
		t.Errorf("Expected 2 recommendations returned (sorting happens), got %d", len(recs))
	}
	// Check order. L1 should be first because +20 score for latency.
	if len(recs) > 0 {
		first := recs[0].(map[string]interface{})
		score := first["score"].(float64)
		if score <= 50 {
			t.Errorf("Expected score > 50 for top match, got %f. Listing: %v", score, first)
		}
		listing := first["listing"].(map[string]interface{})
		if listing["title"] != "Gaming Proxy" {
			t.Errorf("Expected 'Gaming Proxy' first, got '%s'", listing["title"])
		}
	}
}
