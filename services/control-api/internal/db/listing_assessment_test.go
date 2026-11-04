package db

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/core/domain"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/quality"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// This isolated SQLite fixture exercises the repository's actual write gate
// without requiring a running PostgreSQL service. PostgreSQL locking, queue
// constraints and migrations are covered by the API integration tests separately.
func qualityRepositoryFixture(t *testing.T) (*marketplaceRepository, models.ProviderNode, models.ProxyAssessment, domain.ListingEntity) {
	t.Helper()
	t.Setenv("LISTING_QUALITY_MODE", "enforce")
	orm, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	oldDB, oldReplica := DB, ReplicaDB
	DB, ReplicaDB = orm, nil
	t.Cleanup(func() { DB, ReplicaDB = oldDB, oldReplica; conn, _ := orm.DB(); conn.Close() })
	for _, model := range []interface{}{&models.ProviderNode{}, &models.ProxyAssessment{}, &models.ProxyListing{}} {
		stmt := &gorm.Statement{DB: orm}
		if err := stmt.Parse(model); err != nil {
			t.Fatal(err)
		}
		columns := []string{}
		for _, field := range stmt.Schema.Fields {
			if field.DBName == "" {
				continue
			}
			kind := "TEXT"
			switch field.DataType {
			case "time":
				kind = "DATETIME"
			case "bool", "int", "uint":
				kind = "INTEGER"
			case "float":
				kind = "REAL"
			}
			primary := ""
			if field.PrimaryKey {
				primary = " PRIMARY KEY"
			}
			columns = append(columns, fmt.Sprintf("\"%s\" %s%s", field.DBName, kind, primary))
		}
		if err := orm.Exec(fmt.Sprintf("CREATE TABLE %s (%s)", stmt.Schema.Table, strings.Join(columns, ","))).Error; err != nil {
			t.Fatal(err)
		}
	}
	node := models.ProviderNode{ID: uuid.New(), UserID: uuid.New(), Name: "test supply", GatewayNodeID: "node_abc", Hotkey: "bound-key", IPAddress: "203.0.113.1"}
	if err := orm.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	cfg := quality.Configuration{ProxyType: "residential", Protocol: "http", RotationType: "static", Country: "GH", MaxConcurrency: 5}
	a := models.ProxyAssessment{ID: uuid.New(), SellerID: node.UserID, ProviderNodeID: node.ID, ConfigurationHash: quality.Fingerprint(node, cfg), ProxyType: cfg.ProxyType, Protocol: cfg.Protocol, RotationType: cfg.RotationType, Country: cfg.Country, MaxConcurrency: cfg.MaxConcurrency, CreatedAt: time.Now().UTC()}
	if err := quality.Evaluate(&a, quality.Measurements{Samples: 3, SuccessfulSamples: 3, LatencyP50Ms: 100, LatencyP95Ms: 150, ThroughputMbps: 30, BytesTransferred: 786432}, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if err := orm.Create(&a).Error; err != nil {
		t.Fatal(err)
	}
	listing := domain.ListingEntity{ID: uuid.New(), SellerID: node.UserID, ProviderNodeID: &node.ID, QualityAssessmentID: &a.ID, Title: "Measured supply", ProxyType: domain.Residential, Protocol: cfg.Protocol, RotationType: cfg.RotationType, Country: cfg.Country, MaxConcurrency: 5, PricePerGB: a.PricePerGB, Status: domain.ListingActive, AvailableBandwidthGB: 10, MinPurchaseGB: 1}
	return &marketplaceRepository{}, node, a, listing
}

func TestQualityRepositoryRejectsUnassessedPublicationAndPriceTampering(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*domain.ListingEntity)
	}{
		{"missing", func(l *domain.ListingEntity) { l.QualityAssessmentID = nil }},
		{"foreign", func(l *domain.ListingEntity) { l.SellerID = uuid.New() }},
		{"price", func(l *domain.ListingEntity) { l.PricePerGB += .01 }},
		{"concurrency", func(l *domain.ListingEntity) { l.MaxConcurrency++ }},
		{"type", func(l *domain.ListingEntity) { l.ProxyType = domain.Mobile }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo, _, _, listing := qualityRepositoryFixture(t)
			tc.mutate(&listing)
			if err := repo.CreateListing(context.Background(), &listing); err == nil {
				t.Fatal("invalid offer was inserted")
			}
			var count int64
			DB.Model(&models.ProxyListing{}).Count(&count)
			if count != 0 {
				t.Fatal("failed gate left a listing behind")
			}
		})
	}
}

func TestQualityRepositoryPreservesEvidenceAndBlocksEditBypasses(t *testing.T) {
	repo, node, a, listing := qualityRepositoryFixture(t)
	if err := repo.CreateListing(context.Background(), &listing); err != nil {
		t.Fatal(err)
	}
	if listing.UptimePercent != 0 || listing.QualityScore != a.QualityScore || listing.CurrentTier != a.Tier {
		t.Fatalf("default metrics replaced evidence: %+v", listing)
	}
	price := 99.
	if _, err := repo.UpdateListing(context.Background(), listing.ID, domain.ListingUpdate{PricePerGB: &price}); err == nil {
		t.Fatal("price bypass accepted")
	}
	connections := 50
	if _, err := repo.UpdateListing(context.Background(), listing.ID, domain.ListingUpdate{MaxConcurrency: &connections}); err == nil {
		t.Fatal("concurrency bypass accepted")
	}
	if _, err := repo.UpdateListing(context.Background(), listing.ID, domain.ListingUpdate{BulkDiscountsJSON: []byte(`[{"min_gb":1,"price_per_gb":0.01}]`)}); err == nil {
		t.Fatal("bulk price bypass accepted")
	}
	if err := DB.Model(&node).Update("hotkey", "changed").Error; err != nil {
		t.Fatal(err)
	}
	paused := domain.ListingPaused
	if _, err := repo.UpdateListing(context.Background(), listing.ID, domain.ListingUpdate{Status: &paused}); err != nil {
		t.Fatalf("pause must always work: %v", err)
	}
	active := domain.ListingActive
	if _, err := repo.UpdateListing(context.Background(), listing.ID, domain.ListingUpdate{Status: &active}); err == nil {
		t.Fatal("resume accepted after identity changed")
	}
	var stored models.ProxyListing
	DB.First(&stored, "id = ?", listing.ID)
	if stored.PricePerGB != a.PricePerGB || stored.Status != models.ListingStatusPaused {
		t.Fatalf("rejected edits changed offer: %+v", stored)
	}
}

func TestQualityRepositoryObserveModeIsExplicit(t *testing.T) {
	repo, _, _, listing := qualityRepositoryFixture(t)
	t.Setenv("LISTING_QUALITY_MODE", "observe")
	listing.QualityAssessmentID = nil
	if err := repo.CreateListing(context.Background(), &listing); err != nil {
		t.Fatal(err)
	}
}
