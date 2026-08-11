package api

import (
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
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/sessioncache"
	"gorm.io/gorm"
)

func TestHydrateGatewaySession_OK(t *testing.T) {
	gin.SetMode(gin.TestMode)
	gdb, err := gorm.Open(sqlite.Open("file:hydrate_api?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := gdb.AutoMigrate(&models.SessionGatewayCache{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	db.DB = gdb
	redisClient.Client = nil
	redisClient.AfterStoreSession = nil

	user := "cafe1234"
	sid := uuid.New()
	data := &redisClient.SessionData{
		UserID:                 uuid.New().String(),
		SessionID:              sid.String(),
		Status:                 "active",
		BandwidthLimit:         1000,
		CredentialPasswordHash: "deadbeef",
	}
	if err := sessioncache.Upsert(user, data, time.Hour); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	r := gin.New()
	r.GET("/v1/gateway/sessions/hydrate", hydrateGatewaySession)
	req := httptest.NewRequest(http.MethodGet, "/v1/gateway/sessions/hydrate?username="+user, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("json: %v", err)
	}
	if body["source"] != "session_gateway_cache" {
		t.Fatalf("source=%v", body["source"])
	}
	sess, ok := body["session"].(map[string]interface{})
	if !ok || sess["session_id"] != sid.String() {
		t.Fatalf("session=%v", body["session"])
	}
}

func TestHydrateGatewaySession_Miss(t *testing.T) {
	gin.SetMode(gin.TestMode)
	gdb, err := gorm.Open(sqlite.Open("file:hydrate_miss?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	_ = gdb.AutoMigrate(&models.SessionGatewayCache{})
	db.DB = gdb

	r := gin.New()
	r.GET("/v1/gateway/sessions/hydrate", hydrateGatewaySession)
	req := httptest.NewRequest(http.MethodGet, "/v1/gateway/sessions/hydrate?username=missing", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status=%d", w.Code)
	}
}
