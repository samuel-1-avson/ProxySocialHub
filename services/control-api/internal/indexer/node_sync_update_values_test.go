package indexer

import (
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestExplorerNodeSyncValuesIncludesZeros(t *testing.T) {
	values := explorerNodeSyncValues(models.ExplorerNode{})
	for _, key := range []string{"active_sessions", "total_bandwidth", "uptime_percent", "is_validator", "is_active"} {
		if _, ok := values[key]; !ok {
			t.Fatalf("values missing %q: a struct update would skip its zero (audit D5)", key)
		}
	}
}

func TestExplorerNodeSyncValuesLeavesForeignColumnsAlone(t *testing.T) {
	values := explorerNodeSyncValues(models.ExplorerNode{GeoSource: "x", StakeAmount: 5, CommissionRate: 2})
	for _, key := range []string{"geo_source", "geo_resolved_at", "stake_amount", "commission_rate", "id", "node_id", "created_at"} {
		if _, ok := values[key]; ok {
			t.Fatalf("values must not write %q: node sync does not own it", key)
		}
	}
}

func TestExplorerNodeSyncValuesOmitsUnknownOwnerAndHeartbeat(t *testing.T) {
	unknown := explorerNodeSyncValues(models.ExplorerNode{})
	if _, ok := unknown["provider_user_id"]; ok {
		t.Fatal("empty provider_user_id must be omitted: \"\" is invalid for the uuid column")
	}
	if _, ok := unknown["last_heartbeat"]; ok {
		t.Fatal("zero last_heartbeat must be omitted so a stored heartbeat survives")
	}

	seen := time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC)
	known := explorerNodeSyncValues(models.ExplorerNode{ProviderUserID: uuid.NewString(), LastHeartbeat: seen})
	if known["provider_user_id"] == nil || known["provider_user_id"] == "" {
		t.Fatal("known provider_user_id must be written")
	}
	if known["last_heartbeat"] != seen {
		t.Fatalf("last_heartbeat = %v, want %v", known["last_heartbeat"], seen)
	}
}

func TestNodeSyncUpdateWritesZeros(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open("file:node_sync_zeros?mode=memory&cache=shared"), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := gdb.AutoMigrate(&models.ExplorerNode{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	heartbeat := time.Date(2026, 11, 3, 11, 0, 0, 0, time.UTC)
	stored := models.ExplorerNode{
		ID: uuid.New(), NodeID: "node-1", Chain: "solana",
		IsActive: true, IsValidator: true, UptimePercent: 99.5,
		TotalBandwidth: 123456, ActiveSessions: 7,
		GeoSource: "keep-me", StakeAmount: 42,
		ProviderUserID: uuid.NewString(), LastHeartbeat: heartbeat,
	}
	if err := gdb.Create(&stored).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	// The same Model().Updates(...) call syncNode makes, with every
	// sync-owned measurement back at zero.
	zero := models.ExplorerNode{NodeID: "node-1", Chain: "solana"}
	if err := gdb.Model(&stored).Updates(explorerNodeSyncValues(zero)).Error; err != nil {
		t.Fatalf("update: %v", err)
	}

	var after models.ExplorerNode
	if err := gdb.Where("node_id = ?", "node-1").First(&after).Error; err != nil {
		t.Fatalf("reread: %v", err)
	}
	if after.ActiveSessions != 0 || after.TotalBandwidth != 0 || after.UptimePercent != 0 || after.IsValidator || after.IsActive {
		t.Fatalf("zero values not written: sessions=%d bandwidth=%d uptime=%v validator=%v active=%v",
			after.ActiveSessions, after.TotalBandwidth, after.UptimePercent, after.IsValidator, after.IsActive)
	}
	if after.GeoSource != "keep-me" || after.StakeAmount != 42 {
		t.Fatalf("columns sync does not own were clobbered: geo_source=%q stake=%v", after.GeoSource, after.StakeAmount)
	}
	if after.ProviderUserID != stored.ProviderUserID {
		t.Fatalf("provider_user_id = %q, want preserved %q", after.ProviderUserID, stored.ProviderUserID)
	}
	if after.LastHeartbeat.Unix() != heartbeat.Unix() {
		t.Fatalf("last_heartbeat = %v, want preserved %v", after.LastHeartbeat, heartbeat)
	}
}
