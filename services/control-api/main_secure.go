//go:build ignore
// +build ignore

package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-contrib/secure"
	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/api"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/middleware"
	"github.com/proxyhubb/control-api/internal/monitoring"
	"github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/worker"
)

func main() {
	// Load secure configuration (fails if secrets missing)
	cfg, err := config.LoadSecure()
	if err != nil {
		log.Fatalf("❌ Security Configuration Error: %v\n\nPlease ensure all required secrets are set:\n  - JWT_SECRET (64+ chars)\n  - SESSION_SECRET (32+ chars)\n  - ENCRYPTION_KEY (32+ chars)\n  - DATABASE_URL\n  - REDIS_PASSWORD\n\nGenerate with:\n  JWT_SECRET=$(openssl rand -hex 64)\n  SESSION_SECRET=$(openssl rand -hex 64)\n  ENCRYPTION_KEY=$(openssl rand -base64 32)", err)
	}

	log.Printf("✅ Secure configuration loaded (Environment: %s)", cfg.Server.Environment)

	// Initialize database
	if err := db.Init(cfg.Database.DatabaseURL); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	// Initialize Redis
	if err := redis.InitWithPassword(cfg.Redis.URL, cfg.Redis.Password); err != nil {
		log.Fatalf("Failed to initialize Redis: %v", err)
	}

	// Setup Gin
	if cfg.Server.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Recovery())

	// Security middleware stack (ORDER IS IMPORTANT)
	setupSecurityMiddleware(r, cfg)

	// Setup routes
	setupRoutes(r, cfg)

	// Start background workers
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	startWorkers(ctx, cfg)

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		port := cfg.Server.Port
		log.Printf("🚀 Server starting on port %s", port)
		if err := r.Run(":" + port); err != nil {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	<-quit
	log.Println("👋 Shutting down gracefully...")

	// Cancel context to stop workers
	cancel()

	// Give workers time to cleanup
	time.Sleep(2 * time.Second)

	log.Println("✅ Shutdown complete")
}

func setupSecurityMiddleware(r *gin.Engine, cfg *config.SecureConfig) {
	// 1. Request size limit (prevent DoS)
	r.Use(middleware.RequestSizeLimiter(10 * 1024 * 1024)) // 10MB

	// 2. Content-Type validation
	r.Use(middleware.ContentTypeValidator("application/json", "application/x-www-form-urlencoded", "multipart/form-data"))

	// 3. Strict CORS
	r.Use(middleware.StrictCORS(cfg.Server.CORSOrigins, cfg.Server.Environment))

	// 4. Security headers
	securityConfig := secure.Config{
		SSLRedirect:           false, // Handled by load balancer
		IsDevelopment:         cfg.Server.Environment == "development",
		STSSeconds:            315360000,
		STSIncludeSubdomains:  true,
		FrameDeny:             true,
		ContentTypeNosniff:    true,
		BrowserXssFilter:      true,
		ContentSecurityPolicy: "default-src 'self'",
		ReferrerPolicy:        "strict-origin-when-cross-origin",
	}

	if cfg.Server.Environment == "production" {
		securityConfig.AllowedHosts = []string{
			"api.yourdomain.com",
			"yourdomain.com",
		}
	}

	r.Use(secure.New(securityConfig))

	// 5. WAF / Attack detection
	wafConfig := middleware.DefaultWAFConfig()
	wafConfig.Enabled = true
	r.Use(middleware.WAFMiddleware(wafConfig))

	// 6. DDoS Protection
	r.Use(middleware.DDoSProtectionMiddleware(middleware.DefaultDDoSConfig()))

	// 7. Rate limiting
	r.Use(middleware.AdvancedRateLimitByEndpoint())

	// 8. Metrics
	r.Use(monitoring.MetricsMiddleware())

	// 9. Circuit breakers
	r.Use(middleware.CircuitBreakerMiddleware("database", middleware.DefaultCircuitBreakerConfigs["database"]))
	r.Use(middleware.CircuitBreakerMiddleware("redis", middleware.DefaultCircuitBreakerConfigs["redis"]))
}

func setupRoutes(r *gin.Engine, cfg *config.SecureConfig) {
	// Health check (before auth middleware)
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":      "healthy",
			"version":     "1.0.0",
			"environment": cfg.Server.Environment,
		})
	})

	// Public routes
	v1 := r.Group("/v1")
	{
		api.RegisterHealthRoutes(v1)
		api.RegisterAuthRoutes(v1)

		// Public listings
		api.RegisterListingRoutes(v1)
	}

	// Protected routes
	protected := v1.Group("/")
	protected.Use(middleware.RequireAuth())
	{
		api.RegisterProviderNodeRoutes(protected)
		api.RegisterSessionRoutes(protected)
		api.RegisterWalletRoutes(protected)
		api.RegisterOrderRoutes(protected)
		api.RegisterEscrowRoutes(protected)
		// ... other protected routes
	}

	// Admin routes are intentionally disabled.
	admin := v1.Group("/admin")
	admin.Any("", func(c *gin.Context) {
		c.JSON(http.StatusGone, gin.H{"error": "admin_api_disabled"})
	})
	admin.Any("/*path", func(c *gin.Context) {
		c.JSON(http.StatusGone, gin.H{"error": "admin_api_disabled"})
	})
}

func startWorkers(ctx context.Context, cfg *config.SecureConfig) {
	// Start session cleanup worker
	go worker.StartSessionReaper(ctx, 30*time.Minute)

	// Start usage aggregator
	go worker.StartUsageAggregator(ctx, 5*time.Minute)

	log.Println("✅ Background workers started")
}

// Helper to check if string contains any of substrings
func containsAny(s string, substrs []string) bool {
	for _, substr := range substrs {
		if strings.Contains(s, substr) {
			return true
		}
	}
	return false
}
