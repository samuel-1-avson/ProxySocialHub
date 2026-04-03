package billing

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	zkProverRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "proxyhubb_zk_prover_requests_total",
			Help: "Total number of external ZK prover requests by result",
		},
		[]string{"result"}, // success | failed | skipped
	)

	zkProverLatencySeconds = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "proxyhubb_zk_prover_request_duration_seconds",
			Help:    "Latency of external ZK prover requests",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"result"},
	)
)

func recordZKProverResult(result string, durationSeconds float64) {
	zkProverRequestsTotal.WithLabelValues(result).Inc()
	if durationSeconds > 0 {
		zkProverLatencySeconds.WithLabelValues(result).Observe(durationSeconds)
	}
}
