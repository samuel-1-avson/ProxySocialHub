package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

func setupAppealTestDB(t *testing.T) {
	t.Setenv("LISTING_QUALITY_MODE", "observe") // Legacy appeal behavior.
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open("file:appeals_"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	_ = gdb.Exec(`CREATE TABLE proxy_listings (
		id TEXT PRIMARY KEY,
		seller_id TEXT NOT NULL,
		title TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'active',
		listing_offer_hash TEXT NOT NULL DEFAULT '',
		price_per_gb REAL NOT NULL DEFAULT 0,
		available_bandwidth_gb REAL NOT NULL DEFAULT 0,
		created_at DATETIME,
		updated_at DATETIME
	)`).Error
	_ = gdb.Exec(`CREATE TABLE listing_moderation_appeals (
		id TEXT PRIMARY KEY,
		listing_id TEXT NOT NULL,
		seller_id TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'open',
		reason TEXT NOT NULL DEFAULT '',
		evidence TEXT NOT NULL DEFAULT '',
		listing_offer_hash TEXT NOT NULL DEFAULT '',
		delist_reason TEXT NOT NULL DEFAULT '',
		resolution TEXT NOT NULL DEFAULT '',
		resolution_notes TEXT NOT NULL DEFAULT '',
		resolved_by TEXT,
		resolved_at DATETIME,
		appeal_deadline_at DATETIME NOT NULL,
		created_at DATETIME,
		updated_at DATETIME
	)`).Error
	db.DB = gdb
}

func TestCreateAndResolveListingAppeal(t *testing.T) {
	setupAppealTestDB(t)
	gin.SetMode(gin.TestMode)

	sellerID := uuid.New()
	modID := uuid.New()
	listingID := uuid.New()
	if err := db.DB.Exec(
		`INSERT INTO proxy_listings (id, seller_id, title, status, listing_offer_hash, price_per_gb, available_bandwidth_gb, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		listingID.String(), sellerID.String(), "Test listing appeal", string(models.ListingStatusDelisted),
		"abc123", 1.0, 10.0, time.Now().UTC(), time.Now().UTC(),
	).Error; err != nil {
		t.Fatalf("create listing: %v", err)
	}

	r := gin.New()
	r.POST("/listings/:id/appeal", func(c *gin.Context) {
		c.Set("userID", sellerID.String())
		createListingAppeal(c)
	})
	r.POST("/appeals/:id/resolve", func(c *gin.Context) {
		c.Set("userID", modID.String())
		resolveListingAppeal(c)
	})

	body, _ := json.Marshal(map[string]string{
		"reason":   "False positive — offer is valid residential capacity",
		"evidence": "hash matches prior verified offer",
	})
	req := httptest.NewRequest(http.MethodPost, "/listings/"+listingID.String()+"/appeal", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("appeal create: %d %s", w.Code, w.Body.String())
	}

	var created struct {
		Appeal models.ListingModerationAppeal `json:"appeal"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if created.Appeal.Status != models.ListingAppealOpen {
		t.Fatalf("expected open appeal")
	}

	var status string
	_ = db.DB.Raw(`SELECT status FROM proxy_listings WHERE id = ?`, listingID.String()).Scan(&status).Error
	if status != string(models.ListingStatusUnderAppeal) {
		t.Fatalf("expected under_appeal, got %s", status)
	}

	resBody, _ := json.Marshal(map[string]string{"decision": "uphold", "notes": "restored"})
	req2 := httptest.NewRequest(http.MethodPost, "/appeals/"+created.Appeal.ID.String()+"/resolve", bytes.NewReader(resBody))
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("resolve: %d %s", w2.Code, w2.Body.String())
	}
	_ = db.DB.Raw(`SELECT status FROM proxy_listings WHERE id = ?`, listingID.String()).Scan(&status).Error
	if status != string(models.ListingStatusActive) {
		t.Fatalf("expected active after uphold, got %s", status)
	}
}
