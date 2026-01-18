package health

import (
	"context"
	"log"
	"time"

	"github.com/proxyhubb/control-api/internal/cache"
	"github.com/proxyhubb/control-api/internal/db"
)

// SystemHealth represents the status of system dependencies
type SystemHealth struct {
	Healthy     bool          `json:"healthy"`
	Database    Dependency    `json:"database"`
	Redis       Dependency    `json:"redis"`
	LastChecked time.Time     `json:"last_checked"`
	Uptime      time.Duration `json:"uptime" swaggertype:"integer"`
}

type Dependency struct {
	Name    string `json:"name"`
	Healthy bool   `json:"healthy"`
	Latency string `json:"latency"`
	Error   string `json:"error,omitempty"`
}

var (
	startTime = time.Now()
)

// CheckSystem performs an immediate health check of all dependencies
func CheckSystem() SystemHealth {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	health := SystemHealth{
		Healthy:     true,
		LastChecked: time.Now(),
		Uptime:      time.Since(startTime),
	}

	// 1. Check Database
	dbStart := time.Now()
	health.Database = Dependency{Name: "PostgreSQL", Healthy: true}

	if db.DB != nil {
		sqlDB, err := db.DB.DB()
		if err != nil {
			health.Database.Healthy = false
			health.Database.Error = "Failed to get SQL DB handle"
		} else {
			if err := sqlDB.PingContext(ctx); err != nil {
				health.Database.Healthy = false
				health.Database.Error = err.Error()
			}
		}
	} else {
		health.Database.Healthy = false
		health.Database.Error = "Database client not initialized"
	}
	health.Database.Latency = time.Since(dbStart).String()

	// 2. Check Redis
	redisStart := time.Now()
	health.Redis = Dependency{Name: "Redis", Healthy: true}

	if cache.Client != nil {
		if err := cache.Client.Ping(ctx).Err(); err != nil {
			health.Redis.Healthy = false
			health.Redis.Error = err.Error()
		}
	} else {
		health.Redis.Healthy = false
		health.Redis.Error = "Redis client not initialized"
	}
	health.Redis.Latency = time.Since(redisStart).String()

	// Aggregate Health
	if !health.Database.Healthy || !health.Redis.Healthy {
		health.Healthy = false
	}

	return health
}

// StartSystemMonitor starts a background ticker to log health issues
func StartSystemMonitor(interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		for range ticker.C {
			health := CheckSystem()
			if !health.Healthy {
				log.Printf("CRITICAL: System Unhealthy! DB: %v, Redis: %v", health.Database.Healthy, health.Redis.Healthy)
				// TODO: Send email/pagerduty alert here
			}
		}
	}()
	log.Printf("[HealthMonitor] System monitor started (interval: %v)", interval)
}
