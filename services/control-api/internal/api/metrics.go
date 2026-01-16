package api

import (
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ========== Prometheus Metrics ==========

var (
	// Request metrics
	httpRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "proxyhubb_http_requests_total",
			Help: "Total number of HTTP requests",
		},
		[]string{"method", "path", "status"},
	)

	httpRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "proxyhubb_http_request_duration_seconds",
			Help:    "HTTP request latency in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "path"},
	)

	// Session metrics
	activeSessions = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "proxyhubb_active_sessions",
			Help: "Number of currently active proxy sessions",
		},
	)

	sessionCreationsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "proxyhubb_session_creations_total",
			Help: "Total number of sessions created",
		},
		[]string{"type", "tier"},
	)

	// User metrics
	registrationsTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "proxyhubb_registrations_total",
			Help: "Total number of user registrations",
		},
	)

	loginsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "proxyhubb_logins_total",
			Help: "Total number of login attempts",
		},
		[]string{"status"}, // success, failed
	)

	// Wallet metrics
	walletDepositsTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "proxyhubb_wallet_deposits_total",
			Help: "Total number of wallet deposits",
		},
	)

	walletDepositsAmount = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "proxyhubb_wallet_deposits_ghs_total",
			Help: "Total amount deposited in GHS",
		},
	)

	walletWithdrawalsTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "proxyhubb_wallet_withdrawals_total",
			Help: "Total number of wallet withdrawals",
		},
	)

	// Usage metrics
	bandwidthUsedBytes = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "proxyhubb_bandwidth_used_bytes_total",
			Help: "Total bandwidth used in bytes",
		},
	)

	// Provider metrics
	connectedProviders = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "proxyhubb_connected_providers",
			Help: "Number of currently connected providers",
		},
	)

	// KYC metrics
	kycSubmissionsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "proxyhubb_kyc_submissions_total",
			Help: "Total KYC submissions",
		},
		[]string{"status"}, // pending, approved, rejected
	)

	// Rate limiting metrics
	rateLimitHits = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "proxyhubb_rate_limit_hits_total",
			Help: "Total number of rate limit hits",
		},
	)
)

// PrometheusMiddleware records HTTP metrics
func PrometheusMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}

		c.Next()

		duration := time.Since(start).Seconds()
		status := strconv.Itoa(c.Writer.Status())

		httpRequestsTotal.WithLabelValues(c.Request.Method, path, status).Inc()
		httpRequestDuration.WithLabelValues(c.Request.Method, path).Observe(duration)
	}
}

// RegisterMetricsEndpoint registers the /metrics endpoint
func RegisterMetricsEndpoint(r *gin.Engine) {
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))
}

// ========== Metric Recording Helpers ==========

// RecordSessionCreation records a session creation
func RecordSessionCreation(sessionType, tier string) {
	sessionCreationsTotal.WithLabelValues(sessionType, tier).Inc()
	activeSessions.Inc()
}

// RecordSessionTermination records a session termination
func RecordSessionTermination() {
	activeSessions.Dec()
}

// RecordRegistration records a user registration
func RecordRegistration() {
	registrationsTotal.Inc()
}

// RecordLogin records a login attempt
func RecordLogin(success bool) {
	if success {
		loginsTotal.WithLabelValues("success").Inc()
	} else {
		loginsTotal.WithLabelValues("failed").Inc()
	}
}

// RecordDeposit records a wallet deposit
func RecordDeposit(amountGHS float64) {
	walletDepositsTotal.Inc()
	walletDepositsAmount.Add(amountGHS)
}

// RecordWithdrawal records a wallet withdrawal
func RecordWithdrawal() {
	walletWithdrawalsTotal.Inc()
}

// RecordBandwidthUsage records bandwidth usage
func RecordBandwidthUsage(bytes int64) {
	bandwidthUsedBytes.Add(float64(bytes))
}

// RecordKYCSubmission records a KYC submission
func RecordKYCSubmission(status string) {
	kycSubmissionsTotal.WithLabelValues(status).Inc()
}

// RecordRateLimitHit records a rate limit hit
func RecordRateLimitHit() {
	rateLimitHits.Inc()
}

// SetConnectedProviders sets the current connected provider count
func SetConnectedProviders(count int) {
	connectedProviders.Set(float64(count))
}

// SetActiveSessions sets the current active session count
func SetActiveSessions(count int) {
	activeSessions.Set(float64(count))
}
