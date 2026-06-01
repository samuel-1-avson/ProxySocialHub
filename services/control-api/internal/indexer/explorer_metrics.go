package indexer

import (
	"log"
	"os"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm/clause"
)

// ExplorerMetricsAggregator periodically upserts explorer_metrics rows for charts.
type ExplorerMetricsAggregator struct {
	interval time.Duration
	stopCh   chan struct{}
}

// StartExplorerMetricsAggregator runs hourly/daily metric rollups for the public explorer.
func StartExplorerMetricsAggregator(interval time.Duration) *ExplorerMetricsAggregator {
	if interval <= 0 {
		interval = 10 * time.Minute
	}
	a := &ExplorerMetricsAggregator{
		interval: interval,
		stopCh:   make(chan struct{}),
	}
	go a.run()
	log.Printf("[ExplorerMetrics] Aggregator started (interval=%s)", interval)
	return a
}

func (a *ExplorerMetricsAggregator) Stop() {
	close(a.stopCh)
}

func (a *ExplorerMetricsAggregator) run() {
	a.aggregateOnce()
	ticker := time.NewTicker(a.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			a.aggregateOnce()
		case <-a.stopCh:
			return
		}
	}
}

func (a *ExplorerMetricsAggregator) aggregateOnce() {
	now := time.Now().UTC()
	if err := upsertExplorerMetricsBucket("solana", "hourly", now.Truncate(time.Hour)); err != nil {
		log.Printf("[ExplorerMetrics] hourly rollup failed: %v", err)
	}
	if err := upsertExplorerMetricsBucket("solana", "daily", now.Truncate(24*time.Hour)); err != nil {
		log.Printf("[ExplorerMetrics] daily rollup failed: %v", err)
	}
}

func upsertExplorerMetricsBucket(chain, period string, periodStart time.Time) error {
	var windowEnd time.Time
	switch period {
	case "hourly":
		windowEnd = periodStart.Add(time.Hour)
	case "daily":
		windowEnd = periodStart.Add(24 * time.Hour)
	default:
		windowEnd = periodStart.Add(time.Hour)
	}

	txBase := db.DB.Model(&models.ExplorerTransaction{}).
		Where("chain = ? AND is_orphaned = ? AND timestamp >= ? AND timestamp < ?", chain, false, periodStart, windowEnd)

	var totalTx int64
	txBase.Count(&totalTx)

	var totalVolume float64
	txBase.Select("COALESCE(SUM(amount), 0)").Scan(&totalVolume)

	var totalFees, avgFee float64
	txBase.Select("COALESCE(SUM(fee), 0)").Scan(&totalFees)
	if totalTx > 0 {
		avgFee = totalFees / float64(totalTx)
	}

	var activeWallets int64
	db.DB.Raw(`
		SELECT COUNT(DISTINCT addr) FROM (
			SELECT from_address AS addr FROM explorer_transactions
			WHERE chain = ? AND is_orphaned = ? AND timestamp >= ? AND timestamp < ?
			UNION
			SELECT to_address AS addr FROM explorer_transactions
			WHERE chain = ? AND is_orphaned = ? AND timestamp >= ? AND timestamp < ?
		) AS wallets
	`, chain, false, periodStart, windowEnd, chain, false, periodStart, windowEnd).Scan(&activeWallets)

	var activeNodes int64
	db.DB.Model(&models.ExplorerNode{}).
		Where("chain = ? AND is_active = ? AND last_heartbeat >= ? AND last_heartbeat < ?", chain, true, periodStart, windowEnd).
		Count(&activeNodes)

	var avgBlockTime float64
	var blocks []models.ExplorerBlock
	db.DB.Where("chain = ? AND is_orphaned = ? AND timestamp >= ? AND timestamp < ?", chain, false, periodStart, windowEnd).
		Order("block_number ASC").
		Find(&blocks)
	if len(blocks) > 1 {
		var sum float64
		for i := 1; i < len(blocks); i++ {
			sum += blocks[i].Timestamp.Sub(blocks[i-1].Timestamp).Seconds() * 1000
		}
		avgBlockTime = sum / float64(len(blocks)-1)
	}

	var totalBandwidth uint64
	db.DB.Model(&models.ExplorerNode{}).
		Where("chain = ? AND last_heartbeat >= ? AND last_heartbeat < ?", chain, periodStart, windowEnd).
		Select("COALESCE(SUM(total_bandwidth), 0)").
		Scan(&totalBandwidth)

	row := models.ExplorerMetrics{
		ID:                  uuid.New(),
		Chain:               chain,
		Period:              period,
		PeriodStart:         periodStart,
		TotalTransactions:   uint64(totalTx),
		TotalVolume:         totalVolume,
		ActiveWallets:       uint64(activeWallets),
		ActiveNodes:         uint64(activeNodes),
		AverageBlockTime:    avgBlockTime,
		TotalBandwidthBytes: totalBandwidth,
		TotalFees:           totalFees,
		AvgTxFee:            avgFee,
	}

	return db.DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "chain"},
			{Name: "period"},
			{Name: "period_start"},
		},
		DoUpdates: clause.AssignmentColumns([]string{
			"total_transactions",
			"total_volume",
			"active_wallets",
			"active_nodes",
			"average_block_time",
			"total_bandwidth_bytes",
			"total_fees",
			"avg_tx_fee",
		}),
	}).Create(&row).Error
}

// ExplorerMetricsIntervalFromEnv parses EXPLORER_METRICS_INTERVAL (e.g. "10m", "1h").
func ExplorerMetricsIntervalFromEnv() time.Duration {
	raw := os.Getenv("EXPLORER_METRICS_INTERVAL")
	if raw == "" {
		return 10 * time.Minute
	}
	if d, err := time.ParseDuration(raw); err == nil && d > 0 {
		return d
	}
	if mins, err := strconv.Atoi(raw); err == nil && mins > 0 {
		return time.Duration(mins) * time.Minute
	}
	return 10 * time.Minute
}
