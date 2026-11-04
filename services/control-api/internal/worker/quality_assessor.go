package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/quality"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func StartQualityAssessor() {
	GoSupervised("QualityAssessor", 5*time.Second, func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		lastMonitorScan := time.Time{}
		for range ticker.C {
			if time.Since(lastMonitorScan) > time.Minute {
				RunSafely("QualityAssessor.monitor", scheduleQualityMonitoring)
				lastMonitorScan = time.Now()
			}
			RunSafely("QualityAssessor.cycle", runQualityAssessment)
		}
	})
}

func runQualityAssessment() {
	if db.DB == nil {
		return
	}
	// Recover abandoned work after a crash, and expire jobs if no worker could run them.
	now := time.Now().UTC()
	db.DB.Model(&models.ProxyAssessment{}).Where("(status = ? AND created_at < ?) OR (status = ? AND started_at < ?)", "queued", now.Add(-15*time.Minute), "running", now.Add(-2*time.Minute)).Updates(map[string]interface{}{"status": "unavailable", "completed_at": now, "summary": "Assessment worker did not finish. Retry the assessment; no quality conclusion was made."})
	var a models.ProxyAssessment
	err := db.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).Where("status = ?", "queued").Order("created_at").First(&a).Error; err != nil {
			return err
		}
		a.Status, a.StartedAt = "running", &now
		return tx.Model(&a).Updates(map[string]interface{}{"status": a.Status, "started_at": now}).Error
	})
	if err != nil {
		return
	}
	var node models.ProviderNode
	if err = db.DB.First(&node, "id = ? AND user_id = ?", a.ProviderNodeID, a.SellerID).Error; err == nil {
		config := quality.Configuration{ProxyType: a.ProxyType, Protocol: a.Protocol, RotationType: a.RotationType, Country: a.Country, MaxConcurrency: a.MaxConcurrency}
		if quality.Fingerprint(node, config) != a.ConfigurationHash {
			err = errors.New("configuration changed")
		} else {
			var metrics quality.Measurements
			ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
			metrics, err = probeQuality(ctx, marketplace.GatewayRoutingNodeID(&node))
			cancel()
			if err == nil {
				err = quality.Evaluate(&a, metrics, time.Now().UTC())
			}
		}
	}
	if err != nil {
		a.Status, a.Summary = "unavailable", "Assessment could not complete. Check that the gateway and node are available, then retry. No quality conclusion or price was issued."
		completed := time.Now().UTC()
		a.CompletedAt = &completed
	}
	// A timed-out worker cannot overwrite the recovery decision or a newer run.
	result := db.DB.Model(&models.ProxyAssessment{}).Where("id = ? AND status = ?", a.ID, "running").Select("status", "policy_version", "quality_score", "tier", "price_per_gb", "confidence", "provisional", "samples", "successful_samples", "latency_p50_ms", "latency_p95_ms", "throughput_mbps", "bytes_transferred", "summary", "completed_at", "valid_until").Updates(&a)
	if result.Error == nil && result.RowsAffected == 1 && (a.Status == "passed" || a.Status == "failed") {
		// Only evidence changes. Prices, signed offers and existing orders are immutable here.
		updates := map[string]interface{}{"quality_score": a.QualityScore, "current_tier": a.Tier, "avg_latency_ms": int(a.LatencyP50Ms), "success_rate": float64(a.SuccessfulSamples) / 3 * 100}
		if a.Status == "failed" {
			updates["status"] = models.ListingStatusPaused
		}
		db.DB.Model(&models.ProxyListing{}).Where("status = ? AND quality_assessment_id IN (SELECT id FROM proxy_assessments WHERE provider_node_id = ? AND configuration_hash = ?)", models.ListingStatusActive, a.ProviderNodeID, a.ConfigurationHash).Updates(updates)
	}
}

// Recheck assessed live offers every six hours. A unique pending-job index makes
// scheduling safe across replicas; old offers remain untouched during rollout.
func scheduleQualityMonitoring() {
	if db.DB == nil {
		return
	}
	var sources []models.ProxyAssessment
	err := db.DB.Raw(`SELECT DISTINCT a.* FROM proxy_listings pl JOIN proxy_assessments a ON a.id = pl.quality_assessment_id
        WHERE pl.status = 'active' AND NOT EXISTS (SELECT 1 FROM proxy_assessments recent
        WHERE recent.provider_node_id = a.provider_node_id AND recent.configuration_hash = a.configuration_hash AND recent.created_at > ?)
        LIMIT 25`, time.Now().Add(-6*time.Hour)).Scan(&sources).Error
	if err != nil {
		return
	}
	for _, source := range sources {
		var node models.ProviderNode
		if db.DB.First(&node, "id = ?", source.ProviderNodeID).Error != nil {
			continue
		}
		config := quality.Configuration{ProxyType: source.ProxyType, Protocol: source.Protocol, RotationType: source.RotationType, Country: source.Country, MaxConcurrency: source.MaxConcurrency}
		if quality.Fingerprint(node, config) != source.ConfigurationHash {
			// Identity changed: the owner must assess and accept a new offer.
			db.DB.Model(&models.ProxyListing{}).Where("quality_assessment_id = ? AND status = ?", source.ID, models.ListingStatusActive).Update("status", models.ListingStatusPaused)
			continue
		}
		job := models.ProxyAssessment{ID: uuid.New(), SellerID: source.SellerID, ProviderNodeID: source.ProviderNodeID, ConfigurationHash: source.ConfigurationHash, ProxyType: source.ProxyType, Protocol: source.Protocol, RotationType: source.RotationType, Country: source.Country, MaxConcurrency: source.MaxConcurrency, Status: "queued", PolicyVersion: quality.PolicyVersion, Tier: "Unassessed", Provisional: true, CreatedAt: time.Now().UTC()}
		db.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&job)
	}
}

var probeQuality = func(ctx context.Context, nodeID string) (quality.Measurements, error) {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("EDGE_GATEWAY_MGMT_URL")), "/")
	if base == "" {
		base = "http://edge-gateway:8090"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/internal/providers/"+url.PathEscape(nodeID)+"/quality-check", nil)
	if err != nil {
		return quality.Measurements{}, err
	}
	req.Header.Set("X-Gateway-Auth", strings.TrimSpace(os.Getenv("GATEWAY_SHARED_SECRET")))
	client := &http.Client{Timeout: 40 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return quality.Measurements{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return quality.Measurements{}, fmt.Errorf("quality probe status %d", resp.StatusCode)
	}
	var metrics quality.Measurements
	err = json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&metrics)
	return metrics, err
}
