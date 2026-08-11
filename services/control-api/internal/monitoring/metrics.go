package monitoring

import (
	"bytes"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/common/expfmt"
	"github.com/proxyhubb/control-api/internal/solana"
)

// Metrics holds all application metrics
type Metrics struct {
	mu sync.RWMutex

	// HTTP Metrics
	RequestsTotal    map[string]int64     // path -> count
	RequestDuration  map[string][]float64 // path -> durations in ms
	RequestsByStatus map[int]int64        // status code -> count
	RequestsByMethod map[string]int64     // method -> count

	// Auth Metrics
	LoginAttempts    int64
	LoginSuccesses   int64
	LoginFailures    int64
	MFAVerifications int64
	SessionsCreated  int64
	SessionsRevoked  int64
	RateLimitHits    int64
	LockoutEvents    int64

	// Security Metrics
	AnomaliesDetected int64
	AnomaliesResolved int64
	AuditEventsLogged int64

	// System Metrics
	ActiveConnections int64
	StartTime         time.Time
}

var metrics *Metrics
var metricsOnce sync.Once

// GetMetrics returns the global metrics instance
func GetMetrics() *Metrics {
	metricsOnce.Do(func() {
		metrics = &Metrics{
			RequestsTotal:    make(map[string]int64),
			RequestDuration:  make(map[string][]float64),
			RequestsByStatus: make(map[int]int64),
			RequestsByMethod: make(map[string]int64),
			StartTime:        time.Now(),
		}
	})
	return metrics
}

// RecordRequest records an HTTP request
func (m *Metrics) RecordRequest(path, method string, status int, duration time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.RequestsTotal[path]++
	m.RequestsByStatus[status]++
	m.RequestsByMethod[method]++

	// Keep last 1000 durations per path for averaging
	durations := m.RequestDuration[path]
	if len(durations) >= 1000 {
		durations = durations[1:]
	}
	m.RequestDuration[path] = append(durations, float64(duration.Milliseconds()))
}

// RecordLogin records a login attempt
func (m *Metrics) RecordLogin(success bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.LoginAttempts++
	if success {
		m.LoginSuccesses++
	} else {
		m.LoginFailures++
	}
}

// RecordMFAVerification records an MFA verification attempt
func (m *Metrics) RecordMFAVerification() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.MFAVerifications++
}

// RecordSessionCreated records a new session
func (m *Metrics) RecordSessionCreated() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.SessionsCreated++
}

// RecordSessionRevoked records a revoked session
func (m *Metrics) RecordSessionRevoked() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.SessionsRevoked++
}

// RecordRateLimitHit records a rate limit event
func (m *Metrics) RecordRateLimitHit() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.RateLimitHits++
}

// RecordLockout records an account lockout
func (m *Metrics) RecordLockout() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.LockoutEvents++
}

// RecordAnomaly records an anomaly detection
func (m *Metrics) RecordAnomaly(resolved bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.AnomaliesDetected++
	if resolved {
		m.AnomaliesResolved++
	}
}

// RecordAuditEvent records an audit log entry
func (m *Metrics) RecordAuditEvent() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.AuditEventsLogged++
}

// GetSnapshot returns a thread-safe copy of metrics
func (m *Metrics) GetSnapshot() MetricsSnapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()

	snapshot := MetricsSnapshot{
		Uptime:            time.Since(m.StartTime).Seconds(),
		LoginAttempts:     m.LoginAttempts,
		LoginSuccesses:    m.LoginSuccesses,
		LoginFailures:     m.LoginFailures,
		MFAVerifications:  m.MFAVerifications,
		SessionsCreated:   m.SessionsCreated,
		SessionsRevoked:   m.SessionsRevoked,
		RateLimitHits:     m.RateLimitHits,
		LockoutEvents:     m.LockoutEvents,
		AnomaliesDetected: m.AnomaliesDetected,
		AnomaliesResolved: m.AnomaliesResolved,
		AuditEventsLogged: m.AuditEventsLogged,
		RequestsByStatus:  make(map[int]int64),
		RequestsByMethod:  make(map[string]int64),
	}

	for k, v := range m.RequestsByStatus {
		snapshot.RequestsByStatus[k] = v
	}
	for k, v := range m.RequestsByMethod {
		snapshot.RequestsByMethod[k] = v
	}

	// Calculate totals
	for _, count := range m.RequestsTotal {
		snapshot.TotalRequests += count
	}

	// Settlement telemetry aggregates
	settlementTelemetry := solana.GetSettlementTelemetrySnapshot()
	snapshot.SettlementSources = len(settlementTelemetry)
	for _, item := range settlementTelemetry {
		snapshot.SettlementAttempts += item.Attempts
		snapshot.SettlementSuccesses += item.Successes
		snapshot.SettlementFailures += item.Failures
		if item.Source == "missing_source" {
			snapshot.SettlementMissingSourceAttempts += item.Attempts
		}
	}

	return snapshot
}

// MetricsSnapshot is a point-in-time view of metrics
type MetricsSnapshot struct {
	Uptime                          float64          `json:"uptime_seconds"`
	TotalRequests                   int64            `json:"total_requests"`
	LoginAttempts                   int64            `json:"login_attempts"`
	LoginSuccesses                  int64            `json:"login_successes"`
	LoginFailures                   int64            `json:"login_failures"`
	MFAVerifications                int64            `json:"mfa_verifications"`
	SessionsCreated                 int64            `json:"sessions_created"`
	SessionsRevoked                 int64            `json:"sessions_revoked"`
	RateLimitHits                   int64            `json:"rate_limit_hits"`
	LockoutEvents                   int64            `json:"lockout_events"`
	AnomaliesDetected               int64            `json:"anomalies_detected"`
	AnomaliesResolved               int64            `json:"anomalies_resolved"`
	AuditEventsLogged               int64            `json:"audit_events_logged"`
	SettlementSources               int              `json:"settlement_sources"`
	SettlementAttempts              uint64           `json:"settlement_attempts"`
	SettlementSuccesses             uint64           `json:"settlement_successes"`
	SettlementFailures              uint64           `json:"settlement_failures"`
	SettlementMissingSourceAttempts uint64           `json:"settlement_missing_source_attempts"`
	RequestsByStatus                map[int]int64    `json:"requests_by_status"`
	RequestsByMethod                map[string]int64 `json:"requests_by_method"`
}

// PrometheusMetrics returns Prometheus-formatted metrics
func (m *Metrics) PrometheusFormat() string {
	snapshot := m.GetSnapshot()

	var output string

	// Help and type declarations
	output += "# HELP proxyhubb_uptime_seconds Time since service started\n"
	output += "# TYPE proxyhubb_uptime_seconds gauge\n"
	output += "proxyhubb_uptime_seconds " + strconv.FormatFloat(snapshot.Uptime, 'f', 2, 64) + "\n\n"

	output += "# HELP proxyhubb_http_requests_total Total HTTP requests\n"
	output += "# TYPE proxyhubb_http_requests_total counter\n"
	output += "proxyhubb_http_requests_total " + strconv.FormatInt(snapshot.TotalRequests, 10) + "\n\n"

	output += "# HELP proxyhubb_auth_login_total Total login attempts\n"
	output += "# TYPE proxyhubb_auth_login_total counter\n"
	output += "proxyhubb_auth_login_total{result=\"success\"} " + strconv.FormatInt(snapshot.LoginSuccesses, 10) + "\n"
	output += "proxyhubb_auth_login_total{result=\"failure\"} " + strconv.FormatInt(snapshot.LoginFailures, 10) + "\n\n"

	output += "# HELP proxyhubb_mfa_verifications_total Total MFA verifications\n"
	output += "# TYPE proxyhubb_mfa_verifications_total counter\n"
	output += "proxyhubb_mfa_verifications_total " + strconv.FormatInt(snapshot.MFAVerifications, 10) + "\n\n"

	output += "# HELP proxyhubb_sessions_total Total sessions\n"
	output += "# TYPE proxyhubb_sessions_total counter\n"
	output += "proxyhubb_sessions_total{action=\"created\"} " + strconv.FormatInt(snapshot.SessionsCreated, 10) + "\n"
	output += "proxyhubb_sessions_total{action=\"revoked\"} " + strconv.FormatInt(snapshot.SessionsRevoked, 10) + "\n\n"

	output += "# HELP proxyhubb_rate_limit_hits_total Total rate limit hits\n"
	output += "# TYPE proxyhubb_rate_limit_hits_total counter\n"
	output += "proxyhubb_rate_limit_hits_total " + strconv.FormatInt(snapshot.RateLimitHits, 10) + "\n\n"

	output += "# HELP proxyhubb_lockouts_total Total account lockouts\n"
	output += "# TYPE proxyhubb_lockouts_total counter\n"
	output += "proxyhubb_lockouts_total " + strconv.FormatInt(snapshot.LockoutEvents, 10) + "\n\n"

	output += "# HELP proxyhubb_security_anomalies_total Total anomalies\n"
	output += "# TYPE proxyhubb_security_anomalies_total counter\n"
	output += "proxyhubb_security_anomalies_total{status=\"detected\"} " + strconv.FormatInt(snapshot.AnomaliesDetected, 10) + "\n"
	output += "proxyhubb_security_anomalies_total{status=\"resolved\"} " + strconv.FormatInt(snapshot.AnomaliesResolved, 10) + "\n\n"

	output += "# HELP proxyhubb_audit_events_total Total audit events\n"
	output += "# TYPE proxyhubb_audit_events_total counter\n"
	output += "proxyhubb_audit_events_total " + strconv.FormatInt(snapshot.AuditEventsLogged, 10) + "\n\n"

	// HTTP status breakdown
	output += "# HELP proxyhubb_http_requests_by_status HTTP requests by status code\n"
	output += "# TYPE proxyhubb_http_requests_by_status counter\n"
	for status, count := range snapshot.RequestsByStatus {
		output += "proxyhubb_http_requests_by_status{code=\"" + strconv.Itoa(status) + "\"} " + strconv.FormatInt(count, 10) + "\n"
	}

	output += "\n# HELP proxyhubb_settlement_sources Number of settlement sources observed\n"
	output += "# TYPE proxyhubb_settlement_sources gauge\n"
	output += "proxyhubb_settlement_sources " + strconv.Itoa(snapshot.SettlementSources) + "\n\n"

	output += "# HELP proxyhubb_settlement_attempts_all_total Total settlement attempts across all sources\n"
	output += "# TYPE proxyhubb_settlement_attempts_all_total counter\n"
	output += "proxyhubb_settlement_attempts_all_total " + strconv.FormatUint(snapshot.SettlementAttempts, 10) + "\n\n"

	output += "# HELP proxyhubb_settlement_successes_all_total Total settlement successes across all sources\n"
	output += "# TYPE proxyhubb_settlement_successes_all_total counter\n"
	output += "proxyhubb_settlement_successes_all_total " + strconv.FormatUint(snapshot.SettlementSuccesses, 10) + "\n\n"

	output += "# HELP proxyhubb_settlement_failures_all_total Total settlement failures across all sources\n"
	output += "# TYPE proxyhubb_settlement_failures_all_total counter\n"
	output += "proxyhubb_settlement_failures_all_total " + strconv.FormatUint(snapshot.SettlementFailures, 10) + "\n\n"

	output += "# HELP proxyhubb_settlement_missing_source_attempts_total Total settlement attempts blocked for missing source labels\n"
	output += "# TYPE proxyhubb_settlement_missing_source_attempts_total counter\n"
	output += "proxyhubb_settlement_missing_source_attempts_total " + strconv.FormatUint(snapshot.SettlementMissingSourceAttempts, 10) + "\n\n"

	output += "# HELP proxyhubb_settlement_attempts_total Settlement attempts by source\n"
	output += "# TYPE proxyhubb_settlement_attempts_total counter\n"
	output += "# HELP proxyhubb_settlement_successes_total Settlement successes by source\n"
	output += "# TYPE proxyhubb_settlement_successes_total counter\n"
	output += "# HELP proxyhubb_settlement_failures_total Settlement failures by source\n"
	output += "# TYPE proxyhubb_settlement_failures_total counter\n"
	output += "# HELP proxyhubb_settlement_last_seen_unix_seconds Last observed settlement activity timestamp by source\n"
	output += "# TYPE proxyhubb_settlement_last_seen_unix_seconds gauge\n"

	settlementTelemetry := solana.GetSettlementTelemetrySnapshot()
	sort.Slice(settlementTelemetry, func(i, j int) bool {
		return settlementTelemetry[i].Source < settlementTelemetry[j].Source
	})
	for _, item := range settlementTelemetry {
		source := escapePromLabelValue(item.Source)
		output += fmt.Sprintf("proxyhubb_settlement_attempts_total{source=\"%s\"} %d\n", source, item.Attempts)
		output += fmt.Sprintf("proxyhubb_settlement_successes_total{source=\"%s\"} %d\n", source, item.Successes)
		output += fmt.Sprintf("proxyhubb_settlement_failures_total{source=\"%s\"} %d\n", source, item.Failures)
		if !item.LastSeenAt.IsZero() {
			output += fmt.Sprintf("proxyhubb_settlement_last_seen_unix_seconds{source=\"%s\"} %d\n", source, item.LastSeenAt.Unix())
		}
	}

	return output
}

func escapePromLabelValue(v string) string {
	replacer := strings.NewReplacer(
		"\\", "\\\\",
		"\n", "\\n",
		"\"", "\\\"",
	)
	return replacer.Replace(v)
}

// MetricsMiddleware records request metrics
func MetricsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()

		c.Next()

		duration := time.Since(start)
		GetMetrics().RecordRequest(
			c.FullPath(),
			c.Request.Method,
			c.Writer.Status(),
			duration,
		)
	}
}

// RegisterMetricsRoutes registers metrics endpoints
func RegisterMetricsRoutes(r *gin.Engine) {
	// Prometheus metrics endpoint (no auth required for scraping).
	// Emit the hand-rolled proxyhubb_* series plus the default registry
	// (promauto gauges such as nats_consumer_num_pending).
	r.GET("/metrics", func(c *gin.Context) {
		var buf bytes.Buffer
		buf.WriteString(GetMetrics().PrometheusFormat())
		buf.WriteByte('\n')
		if mfs, err := prometheus.DefaultGatherer.Gather(); err == nil {
			for _, mf := range mfs {
				if _, err := expfmt.MetricFamilyToText(&buf, mf); err != nil {
					continue
				}
			}
		}
		c.Data(http.StatusOK, "text/plain; version=0.0.4; charset=utf-8", buf.Bytes())
	})

	// JSON metrics endpoint (for internal use)
	r.GET("/metrics/json", func(c *gin.Context) {
		c.JSON(http.StatusOK, GetMetrics().GetSnapshot())
	})
}
