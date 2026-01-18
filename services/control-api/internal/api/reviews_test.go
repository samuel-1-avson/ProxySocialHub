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

func TestCreateReview_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings", "orders", "reviews", "feed_events")

	// Create Buyer and Seller
	email1 := testutil.UniqueEmail("buyer")
	buyer := testutil.CreateTestUser(t, email1, "buyer")

	email2 := testutil.UniqueEmail("seller")
	seller := testutil.CreateTestUser(t, email2, "provider")

	// Create Listing
	listing := models.ProxyListing{
		SellerID:   seller.ID,
		Title:      "Test Proxy",
		PricePerGB: 1.0,
	}
	db.DB.Create(&listing)

	// Create Order (must be Active/Completed)
	order := models.Order{
		BuyerID:     buyer.ID,
		SellerID:    seller.ID,
		ListingID:   listing.ID,
		Status:      models.OrderStatusCompleted,
		BandwidthGB: 1,
		TotalPrice:  1.0,
	}
	db.DB.Create(&order)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", buyer.ID)
		c.Next()
	})
	r.POST("/reviews", createReview)

	body := models.CreateReviewRequest{
		OrderID: order.ID,
		Rating:  5,
		Title:   "Great Service",
		Content: "Very fast and reliable.",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/reviews", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated && w.Code != http.StatusOK {
		t.Errorf("Expected status 201 or 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	// Verify review
	var review models.Review
	db.DB.First(&review, "order_id = ?", order.ID)
	if review.Rating != 5 {
		t.Errorf("Expected rating 5, got %d", review.Rating)
	}
	if review.VerifiedPurchase != true {
		t.Error("Review should be verified purchase")
	}

	// Verify seller stats
	var updatedSeller models.User
	db.DB.First(&updatedSeller, "id = ?", seller.ID)
	if updatedSeller.ReviewsCount != 1 {
		t.Errorf("Expected reviews count 1, got %d", updatedSeller.ReviewsCount)
	}
	// GORM float precision might vary, checking > 4.9
	if updatedSeller.AvgRating < 4.9 {
		t.Errorf("Expected avg rating ~5.0, got %f", updatedSeller.AvgRating)
	}

	// Verify feed event
	var event models.FeedEvent
	db.DB.Where("target_id = ? AND event_type = ?", review.ID, models.FeedEventNewReview).First(&event)
	if event.ID == uuid.Nil {
		t.Error("Feed event should be created")
	}
}

func TestGetListingReviews(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings", "reviews")

	email := testutil.UniqueEmail("seller")
	seller := testutil.CreateTestUser(t, email, "provider")

	email2 := testutil.UniqueEmail("reviewer")
	reviewer := testutil.CreateTestUser(t, email2, "buyer")

	listing := models.ProxyListing{
		SellerID: seller.ID,
		Title:    "Popular Proxy",
	}
	db.DB.Create(&listing)

	review := models.Review{
		ListingID:  &listing.ID,
		SellerID:   seller.ID,
		ReviewerID: reviewer.ID,
		Rating:     4,
		Title:      "Good",
		Content:    "Nice",
	}
	db.DB.Create(&review)

	r := setupTestRouter()
	r.GET("/listings/:id/reviews", getListingReviews)

	req := httptest.NewRequest("GET", "/listings/"+listing.ID.String()+"/reviews", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	reviews := response["reviews"].([]interface{})
	if len(reviews) != 1 {
		t.Errorf("Expected 1 review, got %d", len(reviews))
	}
}

func TestGetUserReviews(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "reviews")

	email := testutil.UniqueEmail("seller_profile")
	seller := testutil.CreateTestUser(t, email, "provider")

	email2 := testutil.UniqueEmail("reviewer")
	reviewer := testutil.CreateTestUser(t, email2, "buyer")

	review := models.Review{
		SellerID:   seller.ID,
		ReviewerID: reviewer.ID,
		Rating:     5,
		Title:      "Excellent",
	}
	db.DB.Create(&review)

	r := setupTestRouter()
	r.GET("/users/:id/reviews", getUserReviews)

	req := httptest.NewRequest("GET", "/users/"+seller.ID.String()+"/reviews", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	reviews := response["reviews"].([]interface{})
	if len(reviews) != 1 {
		t.Errorf("Expected 1 review, got %d", len(reviews))
	}
}
