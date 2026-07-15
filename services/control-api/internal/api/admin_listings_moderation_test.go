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

func TestGetPendingListingsForModeration(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("mod_pending"), "provider")
	pending := models.ProxyListing{
		SellerID:   provider.ID,
		Title:      "Awaiting review",
		ProxyType:  "residential",
		Protocol:   "http",
		PricePerGB: 2.0,
		Status:     models.ListingStatusPendingReview,
	}
	active := models.ProxyListing{
		SellerID:   provider.ID,
		Title:      "Already live",
		ProxyType:  "residential",
		Protocol:   "http",
		PricePerGB: 2.0,
		Status:     models.ListingStatusActive,
	}
	if err := db.DB.Create(&pending).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.DB.Create(&active).Error; err != nil {
		t.Fatal(err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("userRole", "admin")
	})
	r.GET("/moderation/listings/pending", getPendingListingsForModeration)

	req := httptest.NewRequest("GET", "/moderation/listings/pending", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}

	var resp pendingListingsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Total != 1 || len(resp.Listings) != 1 {
		t.Fatalf("expected 1 pending listing, got total=%d len=%d", resp.Total, len(resp.Listings))
	}
	if resp.Listings[0].ID != pending.ID {
		t.Fatalf("unexpected listing id %s", resp.Listings[0].ID)
	}
}

func TestApprovePendingListing(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("mod_approve"), "provider")
	listing := models.ProxyListing{
		SellerID:   provider.ID,
		Title:      "Approve me",
		ProxyType:  "residential",
		Protocol:   "http",
		PricePerGB: 2.0,
		Status:     models.ListingStatusPendingReview,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatal(err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("userRole", "moderator")
	})
	r.POST("/moderation/listings/:id/approve", approvePendingListing)

	req := httptest.NewRequest(
		"POST",
		"/moderation/listings/"+listing.ID.String()+"/approve",
		bytes.NewReader(nil),
	)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}

	var updated models.ProxyListing
	if err := db.DB.First(&updated, "id = ?", listing.ID).Error; err != nil {
		t.Fatal(err)
	}
	if updated.Status != models.ListingStatusActive {
		t.Fatalf("expected active after approve, got %s", updated.Status)
	}
}

func TestApprovePendingListing_NotFound(t *testing.T) {
	testutil.SetupTestDB(t)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("userRole", "admin")
	})
	r.POST("/moderation/listings/:id/approve", approvePendingListing)

	req := httptest.NewRequest(
		"POST",
		"/moderation/listings/"+uuid.New().String()+"/approve",
		bytes.NewReader(nil),
	)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}
