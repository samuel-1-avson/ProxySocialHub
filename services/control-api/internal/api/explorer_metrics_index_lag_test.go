package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/testutil"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// The metrics handler tolerates failing queries (node counts need Postgres-only SQL), so these
// tests only create the tables whose rows decide the freshness fields.
func setupExplorerMetricsLagDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open("file:explorer_lag_"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	for _, ddl := range []string{
		`CREATE TABLE explorer_blocks (
			id TEXT PRIMARY KEY,
			block_hash TEXT,
			block_number INTEGER,
			chain TEXT,
			timestamp DATETIME,
			transaction_count INTEGER,
			is_orphaned BOOLEAN
		)`,
		`CREATE TABLE explorer_transactions (
			tx_hash TEXT,
			chain TEXT,
			from_address TEXT,
			to_address TEXT,
			amount REAL,
			status TEXT,
			timestamp DATETIME,
			is_orphaned BOOLEAN
		)`,
	} {
		if err := gdb.Exec(ddl).Error; err != nil {
			t.Fatalf("create table: %v", err)
		}
	}
	previous := db.DB
	db.DB = gdb
	t.Cleanup(func() { db.DB = previous })
	return gdb
}

func withoutExplorerRedis(t *testing.T) {
	t.Helper()
	previous := redisClient.Client
	redisClient.Client = nil
	t.Cleanup(func() { redisClient.Client = previous })
}

func insertExplorerBlock(t *testing.T, gdb *gorm.DB, number uint64, at time.Time, orphaned bool) {
	t.Helper()
	id := uuid.New().String()
	if err := gdb.Exec(
		`INSERT INTO explorer_blocks (id, block_hash, block_number, chain, timestamp, transaction_count, is_orphaned) VALUES (?, ?, ?, 'solana', ?, 3, ?)`,
		id, "hash-"+id, number, at, orphaned,
	).Error; err != nil {
		t.Fatalf("insert block: %v", err)
	}
}

func requestExplorerMetrics(t *testing.T) map[string]any {
	t.Helper()
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/explorer/metrics", nil)
	getExplorerMetrics(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return body
}

func seedExplorerMetricsCache(t *testing.T, response ExplorerMetricsResponse) {
	t.Helper()
	raw, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if err := redisClient.Client.Set(context.Background(), "explorer:metrics:solana", raw, time.Minute).Err(); err != nil {
		t.Fatalf("seed cache: %v", err)
	}
}

func TestExplorerMetricsReportsHowOldTheNewestIndexedBlockIs(t *testing.T) {
	withoutExplorerRedis(t)
	gdb := setupExplorerMetricsLagDB(t)
	head := time.Now().UTC().Add(-10 * time.Minute)
	insertExplorerBlock(t, gdb, 518284100, head.Add(-time.Hour), false)
	insertExplorerBlock(t, gdb, 518284205, head, false)
	// A newer block on a fork that lost must not count as the head.
	insertExplorerBlock(t, gdb, 518284300, time.Now().UTC(), true)

	body := requestExplorerMetrics(t)

	if body["block_height"] != float64(518284205) {
		t.Fatalf("block_height = %v, want the newest non-orphaned block", body["block_height"])
	}
	stamp, ok := body["indexed_head_time"].(string)
	if !ok {
		t.Fatalf("indexed_head_time missing: %v", body)
	}
	parsed, err := time.Parse(time.RFC3339Nano, stamp)
	if err != nil {
		t.Fatalf("indexed_head_time %q: %v", stamp, err)
	}
	if diff := parsed.Sub(head); diff < -2*time.Second || diff > 2*time.Second {
		t.Fatalf("indexed_head_time = %s, want about %s", parsed, head)
	}
	lag, ok := body["indexed_lag_seconds"].(float64)
	if !ok || lag < 598 || lag > 625 {
		t.Fatalf("indexed_lag_seconds = %v, want about 600", body["indexed_lag_seconds"])
	}
}

func TestExplorerMetricsLeavesFreshnessOutWhenNothingIsIndexed(t *testing.T) {
	withoutExplorerRedis(t)
	setupExplorerMetricsLagDB(t)

	body := requestExplorerMetrics(t)

	for _, key := range []string{"indexed_head_time", "indexed_lag_seconds"} {
		if _, present := body[key]; present {
			t.Fatalf("%s must be omitted when there is no indexed block, got %v", key, body[key])
		}
	}
}

func TestExplorerMetricsRecomputesTheLagOfACachedResponse(t *testing.T) {
	setupExplorerMetricsLagDB(t)
	testutil.SetupTestRedis(t)
	head := time.Now().UTC().Add(-time.Hour)
	stale := int64(5) // the lag these numbers had when they were cached
	seedExplorerMetricsCache(t, ExplorerMetricsResponse{
		Chain: "solana", DataSource: "live", BlockHeight: 7, TotalTransactions: 1,
		TpsWindowHours: 24, TPS: 0.5, IndexedHeadTime: &head, IndexedLagSeconds: &stale,
	})

	body := requestExplorerMetrics(t)

	if body["block_height"] != float64(7) {
		t.Fatalf("block_height = %v: this must be the cached response, not a fresh one", body["block_height"])
	}
	lag, ok := body["indexed_lag_seconds"].(float64)
	if !ok || lag < 3598 || lag > 3625 {
		t.Fatalf("indexed_lag_seconds = %v, want about 3600 (recomputed), not the cached 5", body["indexed_lag_seconds"])
	}
}

func TestExplorerMetricsCachedBeforeThisFieldExistedStaysUnknown(t *testing.T) {
	setupExplorerMetricsLagDB(t)
	testutil.SetupTestRedis(t)
	seedExplorerMetricsCache(t, ExplorerMetricsResponse{
		Chain: "solana", DataSource: "live", BlockHeight: 7, TotalTransactions: 1, TpsWindowHours: 24, TPS: 0.5,
	})

	body := requestExplorerMetrics(t)

	if body["block_height"] != float64(7) {
		t.Fatalf("block_height = %v: this must be the cached response", body["block_height"])
	}
	for _, key := range []string{"indexed_head_time", "indexed_lag_seconds"} {
		if _, present := body[key]; present {
			t.Fatalf("%s must stay omitted for an old cache entry, got %v", key, body[key])
		}
	}
}
