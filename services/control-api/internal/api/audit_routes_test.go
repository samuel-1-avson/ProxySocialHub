package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// Settings > Security activity reads /v1/audit/logs and /v1/audit/anomalies.
// This package builds their services in init(), before the database is
// connected; they used to copy that nil db.DB, so every call panicked and the
// page showed "This data is unavailable". The router here is set up after
// SetupTestDB, i.e. after init(), the same order as main.

func auditRouterAs(userID uuid.UUID) *gin.Engine {
	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	})
	RegisterAuditRoutes(r.Group("/v1"))
	return r
}

func TestAuditRoutesServeOnlyTheCallersRows(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "audit_logs", "security_anomalies", "user_flags")

	me := testutil.CreateTestUser(t, testutil.UniqueEmail("auditme"), "buyer")
	other := testutil.CreateTestUser(t, testutil.UniqueEmail("auditother"), "buyer")

	for _, actor := range []*models.User{me, other} {
		row := models.AuditLog{
			EventType:   models.AuditAuthLogin,
			Severity:    models.AuditSeverityInfo,
			ActorID:     &actor.ID,
			ActorType:   "user",
			IPAddress:   "203.0.113.7",
			Description: "Account sign-in completed",
			Success:     true,
		}
		if err := db.DB.Create(&row).Error; err != nil {
			t.Fatalf("create audit log: %v", err)
		}
	}
	mine := models.SecurityAnomaly{UserID: me.ID, AnomalyType: "geo_change", Severity: "high", DetectedIP: "198.51.100.9"}
	theirs := models.SecurityAnomaly{UserID: other.ID, AnomalyType: "velocity", Severity: "medium", DetectedIP: "198.51.100.10"}
	for _, a := range []*models.SecurityAnomaly{&mine, &theirs} {
		if err := db.DB.Create(a).Error; err != nil {
			t.Fatalf("create anomaly: %v", err)
		}
	}

	r := auditRouterAs(me.ID)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/audit/logs?limit=50", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("GET /v1/audit/logs = %d, want 200: %s", w.Code, w.Body.String())
	}
	var logs struct {
		Logs []models.AuditLog `json:"logs"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &logs); err != nil {
		t.Fatalf("decode logs: %v", err)
	}
	if len(logs.Logs) != 1 || logs.Logs[0].ActorID == nil || *logs.Logs[0].ActorID != me.ID {
		t.Fatalf("logs = %+v, want exactly the caller's one sign-in", logs.Logs)
	}

	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/audit/anomalies", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("GET /v1/audit/anomalies = %d, want 200: %s", w.Code, w.Body.String())
	}
	var alerts struct {
		Anomalies []anomalyListItem `json:"anomalies"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &alerts); err != nil {
		t.Fatalf("decode anomalies: %v", err)
	}
	if len(alerts.Anomalies) != 1 || alerts.Anomalies[0].ID != mine.ID.String() || alerts.Anomalies[0].IsResolved {
		t.Fatalf("anomalies = %+v, want only the caller's unresolved %s", alerts.Anomalies, mine.ID)
	}
}

func TestResolveAnomalyMarksTheCallersAlert(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "security_anomalies")

	me := testutil.CreateTestUser(t, testutil.UniqueEmail("auditresolve"), "buyer")
	alert := models.SecurityAnomaly{UserID: me.ID, AnomalyType: "geo_change", Severity: "high"}
	if err := db.DB.Create(&alert).Error; err != nil {
		t.Fatalf("create anomaly: %v", err)
	}

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/audit/anomalies/"+alert.ID.String()+"/resolve",
		strings.NewReader(`{"resolution":"It was me, travelling."}`))
	req.Header.Set("Content-Type", "application/json")
	auditRouterAs(me.ID).ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("resolve = %d, want 200: %s", w.Code, w.Body.String())
	}

	var got models.SecurityAnomaly
	if err := db.DB.First(&got, "id = ?", alert.ID).Error; err != nil {
		t.Fatalf("reload anomaly: %v", err)
	}
	if !got.IsResolved || got.Resolution != "It was me, travelling." || got.ResolvedBy == nil || *got.ResolvedBy != me.ID {
		t.Fatalf("anomaly after resolve = %+v, want resolved by the caller with the note", got)
	}
}
