package db

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"gorm.io/gorm"
)

// dbQueryDuration tracks GORM operation latency as a Prometheus histogram.
// Labels: operation (query|create|update|delete), table name.
var dbQueryDuration = promauto.NewHistogramVec(
	prometheus.HistogramOpts{
		Namespace: "proxyhubb",
		Subsystem: "db",
		Name:      "query_duration_seconds",
		Help:      "Duration of GORM database operations in seconds.",
		Buckets:   []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5},
	},
	[]string{"operation", "table"},
)

// RegisterMetricsPlugin wires Prometheus query-duration instrumentation into a GORM instance.
// It uses GORM's Before/After callback pairs to capture elapsed wall-clock time without
// requiring any manual instrumentation in individual API handlers.
func RegisterMetricsPlugin(db *gorm.DB) {
	// SELECT / raw queries
	db.Callback().Query().Before("gorm:query").Register("metrics:before_query", stampStartTime())
	db.Callback().Query().After("gorm:query").Register("metrics:after_query", recordDuration("query"))

	// INSERT
	db.Callback().Create().Before("gorm:create").Register("metrics:before_create", stampStartTime())
	db.Callback().Create().After("gorm:create").Register("metrics:after_create", recordDuration("create"))

	// UPDATE
	db.Callback().Update().Before("gorm:update").Register("metrics:before_update", stampStartTime())
	db.Callback().Update().After("gorm:update").Register("metrics:after_update", recordDuration("update"))

	// DELETE
	db.Callback().Delete().Before("gorm:delete").Register("metrics:before_delete", stampStartTime())
	db.Callback().Delete().After("gorm:delete").Register("metrics:after_delete", recordDuration("delete"))
}

// stampStartTime is the Before callback that records the start time in the statement context.
func stampStartTime() func(*gorm.DB) {
	return func(tx *gorm.DB) {
		if tx.Statement != nil {
			tx.Statement.Context = contextWithStartTime(tx.Statement.Context)
		}
	}
}

// recordDuration is the After callback that reads the start time and observes the histogram.
func recordDuration(op string) func(*gorm.DB) {
	return func(tx *gorm.DB) {
		if tx.Statement == nil {
			return
		}
		start, ok := startTimeFromContext(tx.Statement.Context)
		if !ok {
			return
		}
		table := tx.Statement.Table
		if table == "" {
			table = "unknown"
		}
		dbQueryDuration.WithLabelValues(op, table).Observe(time.Since(start).Seconds())
	}
}
