package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// F12: network summaries must not convert missing measurements or source
// failures into credible zeros, and must carry freshness metadata that
// separates registered nodes from recently observed ones.

func f12GetStatus(t *testing.T) *httptest.ResponseRecorder {
	t.Helper()
	r := setupTestRouter()
	RegisterNetworkRoutes(r.Group("/"))
	req := httptest.NewRequest(http.MethodGet, "/network/status", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestF12NoNodesDistinguishesUnmeasuredFromZero(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "nodes", "users")

	w := f12GetStatus(t)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !strings.Contains(body, `"avg_latency":null`) {
		t.Fatalf("unmeasured latency must be null, not 0. Body: %s", body)
	}
	if !strings.Contains(body, `"latency_sample_size":0`) {
		t.Fatalf("expected latency_sample_size 0. Body: %s", body)
	}
	if !strings.Contains(body, `"last_observed_at":null`) {
		t.Fatalf("expected last_observed_at null with no nodes. Body: %s", body)
	}

	var resp struct {
		ObservedAt          time.Time `json:"observed_at"`
		StaleAfterSeconds   int64     `json:"stale_after_seconds"`
		HealthyRecentlySeen int64     `json:"healthy_recently_observed_nodes"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.ObservedAt.IsZero() {
		t.Fatalf("expected observed_at timestamp")
	}
	if resp.StaleAfterSeconds != 300 {
		t.Fatalf("expected default stale_after_seconds 300 (shared heartbeat default), got %d", resp.StaleAfterSeconds)
	}
	if resp.HealthyRecentlySeen != 0 {
		t.Fatalf("expected 0 recently observed, got %d", resp.HealthyRecentlySeen)
	}
}

func TestF12RecentlyObservedSeparatesStaleHealthyFlags(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "nodes", "users")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("f12provider"), "provider")
	now := time.Now().UTC().Truncate(time.Second)

	mk := func(lastSeen time.Time, latency int) models.Node {
		n := models.Node{
			ID:             uuid.New(),
			UserID:         provider.ID,
			ProviderUserID: provider.ID,
			CountryCode:    "US",
			Region:         "us-east",
			IsHealthy:      true,
			LatencyMs:      latency,
			QualityScore:   90,
			LastSeenAt:     lastSeen,
		}
		if err := db.DB.Create(&n).Error; err != nil {
			t.Fatalf("create node: %v", err)
		}
		// Pin last_seen_at explicitly (Create may normalize timestamps).
		if err := db.DB.Model(&models.Node{}).Where("id = ?", n.ID).
			Update("last_seen_at", lastSeen).Error; err != nil {
			t.Fatalf("pin last_seen_at: %v", err)
		}
		return n
	}
	mk(now.Add(-2*time.Minute), 40) // fresh
	mk(now.Add(-2*time.Hour), 60)   // stale healthy flag

	w := f12GetStatus(t)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		TotalNodes          int64      `json:"total_nodes"`
		HealthyNodes        int64      `json:"healthy_nodes"`
		HealthyRecentlySeen int64      `json:"healthy_recently_observed_nodes"`
		AvgLatency          *float64   `json:"avg_latency"`
		LatencySampleSize   int64      `json:"latency_sample_size"`
		LastObservedAt      *time.Time `json:"last_observed_at"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.TotalNodes != 2 || resp.HealthyNodes != 2 {
		t.Fatalf("expected registered/healthy-flagged 2/2, got %d/%d", resp.TotalNodes, resp.HealthyNodes)
	}
	if resp.HealthyRecentlySeen != 1 {
		t.Fatalf("expected exactly 1 recently observed healthy node, got %d", resp.HealthyRecentlySeen)
	}
	if resp.AvgLatency == nil || *resp.AvgLatency != 50 {
		t.Fatalf("expected avg_latency 50 across both samples, got %v", resp.AvgLatency)
	}
	if resp.LatencySampleSize != 2 {
		t.Fatalf("expected latency_sample_size 2, got %d", resp.LatencySampleSize)
	}
	if resp.LastObservedAt == nil || !resp.LastObservedAt.Equal(now.Add(-2*time.Minute)) {
		t.Fatalf("expected last_observed_at = fresh heartbeat %v, got %v", now.Add(-2*time.Minute), resp.LastObservedAt)
	}
}

func TestF12SourceFailureReturnsErrorNotZeros(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "nodes", "users")

	if err := db.DB.Exec(`ALTER TABLE nodes RENAME TO nodes_f12_hidden`).Error; err != nil {
		t.Fatalf("hide nodes table: %v", err)
	}
	defer func() {
		if err := db.DB.Exec(`ALTER TABLE nodes_f12_hidden RENAME TO nodes`).Error; err != nil {
			t.Fatalf("restore nodes table: %v", err)
		}
	}()

	w := f12GetStatus(t)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 on source failure (not credible zeros), got %d: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), `"total_nodes":0`) {
		t.Fatalf("failure must not be reported as zero nodes. Body: %s", w.Body.String())
	}
}
