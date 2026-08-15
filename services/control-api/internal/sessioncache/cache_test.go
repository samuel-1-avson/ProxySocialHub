package sessioncache

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

func setupCacheTestDB(t *testing.T) {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open("file:sessioncache_" + t.Name() + "?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := gdb.AutoMigrate(&models.SessionGatewayCache{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	db.DB = gdb
}

func TestHashUsernameStable(t *testing.T) {
	a := HashUsername("abc12345")
	b := HashUsername("abc12345")
	if a != b || len(a) != 64 {
		t.Fatalf("hash unstable or wrong len: %q", a)
	}
	if HashUsername("other") == a {
		t.Fatal("expected different hash")
	}
}

func TestUpsertGetDelete(t *testing.T) {
	setupCacheTestDB(t)
	sid := uuid.New()
	user := "deadbeef"
	data := &redisClient.SessionData{
		UserID:                 uuid.New().String(),
		SessionID:              sid.String(),
		Status:                 "active",
		BandwidthLimit:         1024,
		CredentialPasswordHash: "aabbcc",
	}
	if err := Upsert(user, data, time.Hour); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	got, exp, err := GetByUsername(user)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.SessionID != sid.String() || got.CredentialPasswordHash != "aabbcc" {
		t.Fatalf("payload mismatch: %+v", got)
	}
	if time.Until(exp) < 30*time.Minute {
		t.Fatalf("expires too soon: %v", exp)
	}
	// upsert refresh
	data.BandwidthUsed = 99
	if err := Upsert(user, data, 2*time.Hour); err != nil {
		t.Fatalf("re-upsert: %v", err)
	}
	got, _, err = GetByUsername(user)
	if err != nil || got.BandwidthUsed != 99 {
		t.Fatalf("re-get: %+v err=%v", got, err)
	}
	if err := DeleteByUsername(user); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, _, err := GetByUsername(user); err == nil {
		t.Fatal("expected miss after delete")
	}
}

func TestGetExpiredMiss(t *testing.T) {
	setupCacheTestDB(t)
	sid := uuid.New()
	user := "expired1"
	raw, _ := json.Marshal(&redisClient.SessionData{SessionID: sid.String(), Status: "active"})
	row := models.SessionGatewayCache{
		CredentialsUserHash: HashUsername(user),
		SessionID:           sid,
		Payload:             datatypes.JSON(raw),
		ExpiresAt:           time.Now().UTC().Add(-time.Minute),
		UpdatedAt:           time.Now().UTC(),
	}
	if err := db.DB.Create(&row).Error; err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, _, err := GetByUsername(user); err == nil {
		t.Fatal("expected expired miss")
	}
}

func TestDeleteExpired(t *testing.T) {
	setupCacheTestDB(t)
	now := time.Now().UTC()
	raw, _ := json.Marshal(&redisClient.SessionData{SessionID: uuid.New().String(), Status: "active"})
	expired := models.SessionGatewayCache{
		CredentialsUserHash: HashUsername("reap-me"),
		SessionID:           uuid.New(),
		Payload:             datatypes.JSON(raw),
		ExpiresAt:           now.Add(-time.Hour),
		UpdatedAt:           now,
	}
	live := models.SessionGatewayCache{
		CredentialsUserHash: HashUsername("keep-me"),
		SessionID:           uuid.New(),
		Payload:             datatypes.JSON(raw),
		ExpiresAt:           now.Add(time.Hour),
		UpdatedAt:           now,
	}
	if err := db.DB.Create(&expired).Error; err != nil {
		t.Fatalf("create expired: %v", err)
	}
	if err := db.DB.Create(&live).Error; err != nil {
		t.Fatalf("create live: %v", err)
	}
	n, err := DeleteExpired(now, 100)
	if err != nil || n != 1 {
		t.Fatalf("DeleteExpired: n=%d err=%v", n, err)
	}
	if _, _, err := GetByUsername("keep-me"); err != nil {
		t.Fatalf("live row should remain: %v", err)
	}
	var count int64
	db.DB.Model(&models.SessionGatewayCache{}).Count(&count)
	if count != 1 {
		t.Fatalf("expected 1 row left, got %d", count)
	}
}
