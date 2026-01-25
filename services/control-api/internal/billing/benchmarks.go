package billing

import (
	"sync"
	"time"

	"github.com/proxyhubb/control-api/internal/logging"
)

// ZKBenchmarkMetrics represents aggregated performance stats
type ZKBenchmarkMetrics struct {
	TotalProofsProcessed int64     `json:"total_proofs"`
	AvgAggregationTimeMs float64   `json:"avg_aggregation_time_ms"`
	MaxAggregationTimeMs float64   `json:"max_aggregation_time_ms"`
	ThroughputCPS        float64   `json:"throughput_cps"` // Checkpoints Per Second
	CompressionRatio     float64   `json:"compression_ratio"`
	LastUpdated          time.Time `json:"last_updated"`
}

type ZKBenchmarkEngine struct {
	mu         sync.RWMutex
	proofCount int64
	totalTime  time.Duration
	maxTime    time.Duration
	bytesIn    int64
	bytesOut   int64
	startTime  time.Time
}

var (
	BenchmarkEngine *ZKBenchmarkEngine
	once            sync.Once
)

func GetBenchmarkEngine() *ZKBenchmarkEngine {
	once.Do(func() {
		BenchmarkEngine = &ZKBenchmarkEngine{
			startTime: time.Now(),
		}
	})
	return BenchmarkEngine
}

// RecordAggregation logs a single proof aggregation event
func (e *ZKBenchmarkEngine) RecordAggregation(duration time.Duration, fragmentsCount int, bIn, bOut int64) {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.proofCount += int64(fragmentsCount)
	e.totalTime += duration
	if duration > e.maxTime {
		e.maxTime = duration
	}
	e.bytesIn += bIn
	e.bytesOut += bOut

	logging.Info().
		Int("fragments", fragmentsCount).
		Int64("duration_ms", duration.Milliseconds()).
		Msg("ZK Benchmark Event Recorded")
}

// GetMetrics returns the current window of performance intelligence
func (e *ZKBenchmarkEngine) GetMetrics() ZKBenchmarkMetrics {
	e.mu.RLock()
	defer e.mu.RUnlock()

	avgTime := 0.0
	if e.proofCount > 0 {
		avgTime = float64(e.totalTime.Milliseconds()) / float64(e.proofCount)
	}

	ratio := 1.0
	if e.bytesOut > 0 {
		ratio = float64(e.bytesIn) / float64(e.bytesOut)
	}

	uptimeSec := time.Since(e.startTime).Seconds()
	cps := float64(e.proofCount) / uptimeSec

	return ZKBenchmarkMetrics{
		TotalProofsProcessed: e.proofCount,
		AvgAggregationTimeMs: avgTime,
		MaxAggregationTimeMs: float64(e.maxTime.Milliseconds()),
		ThroughputCPS:        cps,
		CompressionRatio:     ratio,
		LastUpdated:          time.Now(),
	}
}

// GetLatencyDistribution returns mock heatmap data for Phase 10.4 visual verification
func (e *ZKBenchmarkEngine) GetLatencyDistribution() map[string]int {
	// In production, this would bucket actual recorded latencies from a time-series DB
	return map[string]int{
		"0-50ms":    150,
		"50-100ms":  420,
		"100-200ms": 85,
		"200-500ms": 12,
		"500ms+":    5,
	}
}
