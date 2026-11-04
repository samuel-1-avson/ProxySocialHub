package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func assessmentTestRouter(userID uuid.UUID) *gin.Engine {
	r := setupTestRouter()
	r.Use(func(c *gin.Context) { c.Set("user_id", userID) })
	r.POST("/proxy-assessments", createProxyAssessment)
	r.GET("/proxy-assessments/:id", getProxyAssessment)
	return r
}

func TestQualityAssessmentQueueIsOwnedAndDeduplicated(t *testing.T) {
	testutil.SetupTestDB(t)
	owner := testutil.CreateTestUser(t, testutil.UniqueEmail("quality-owner"), "provider")
	other := testutil.CreateTestUser(t, testutil.UniqueEmail("quality-other"), "provider")
	node := createVerifiedNode(t, owner.ID, time.Now())
	body := `{"provider_node_id":"` + node.ID.String() + `","proxy_type":"residential","protocol":"HTTP","rotation_type":"static","country":"GH","max_concurrency":5,"quality_score":100,"price_per_gb":99}`
	router := assessmentTestRouter(owner.ID)
	first := postRawJSON(router, "/proxy-assessments", []byte(body))
	if first.Code != http.StatusAccepted {
		t.Fatalf("queue: %d %s", first.Code, first.Body)
	}
	var a models.ProxyAssessment
	if err := json.Unmarshal(first.Body.Bytes(), &a); err != nil {
		t.Fatal(err)
	}
	if a.PricePerGB != 0 || a.QualityScore != 0 || a.Status != "queued" || a.Protocol != "http" {
		t.Fatalf("client-supplied measurements were trusted: %+v", a)
	}
	repeat := postRawJSON(router, "/proxy-assessments", []byte(body))
	var b models.ProxyAssessment
	json.Unmarshal(repeat.Body.Bytes(), &b)
	if repeat.Code != http.StatusAccepted || b.ID != a.ID {
		t.Fatalf("duplicate queued job: %s", repeat.Body)
	}
	foreign := postRawJSON(assessmentTestRouter(other.ID), "/proxy-assessments", []byte(body))
	if foreign.Code != http.StatusNotFound {
		t.Fatalf("foreign node accepted: %d", foreign.Code)
	}
	w := httptest.NewRecorder()
	assessmentTestRouter(other.ID).ServeHTTP(w, httptest.NewRequest("GET", "/proxy-assessments/"+a.ID.String(), nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("foreign report exposed: %d", w.Code)
	}
	if err := db.DB.Model(&a).Update("status", "failed").Error; err != nil {
		t.Fatal(err)
	}
	cooldown := postRawJSON(router, "/proxy-assessments", []byte(body))
	if cooldown.Code != http.StatusTooManyRequests {
		t.Fatalf("missing cooldown: %d %s", cooldown.Code, cooldown.Body)
	}
}

func TestQualityCreateListingCannotBypassAssessment(t *testing.T) {
	testutil.SetupTestDB(t)
	t.Setenv("LISTING_QUALITY_MODE", "enforce")
	owner := testutil.CreateTestUser(t, testutil.UniqueEmail("quality-listing"), "provider")
	r := setupTestRouter()
	r.Use(func(c *gin.Context) { c.Set("user_id", owner.ID) })
	r.POST("/listings", createListing)
	w := postRawJSON(r, "/listings", []byte(`{"title":"Unassessed capacity","proxy_type":"residential","protocol":"http","price_per_gb":1,"available_bandwidth_gb":10,"max_concurrency":5}`))
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "quality assessment required") {
		t.Fatalf("publication bypass: %d %s", w.Code, w.Body)
	}
}
