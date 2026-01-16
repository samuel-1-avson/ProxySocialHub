package main

import (
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/proxyhubb/control-api/internal/api"
	"github.com/proxyhubb/control-api/internal/cache"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/email"
	"github.com/proxyhubb/control-api/internal/health"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/middleware"
)

func main() {
	// Load .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found or error loading it")
	}

	// Basic setup
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Initialize structured logging
	logging.Init()

	db.Init()

	// Initialize Redis cache
	if err := cache.Connect(); err != nil {
		log.Printf("Warning: Redis connection failed: %v", err)
	}
	defer cache.Close()

	// Initialize Email service
	if err := email.Init(); err != nil {
		log.Printf("Warning: Email service initialization failed: %v", err)
	}

	r := gin.Default()

	// CORS Middleware with configurable origins
	r.Use(corsMiddleware())

	// Request ID and structured logging
	r.Use(logging.RequestID())
	r.Use(logging.RequestLogger())

	// Security Middleware
	r.Use(api.SecureHeaders())
	r.Use(api.InputValidationMiddleware())
	r.Use(middleware.RateLimitByEndpoint()) // Redis-backed rate limiting
	r.Use(api.PrometheusMiddleware())

	// Health check (public)
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "control-api"})
	})

	// Metrics endpoint (public)
	api.RegisterMetricsEndpoint(r)

	// Public routes (no auth required)
	public := r.Group("/v1")
	{
		api.RegisterAuthRoutes(public)
	}

	// Protected routes (auth required - JWT or API Key)
	protected := r.Group("/v1")
	protected.Use(api.APIKeyAuthMiddleware()) // Try API key first
	protected.Use(api.AuthMiddleware())       // Fall back to JWT
	{
		api.RegisterKycRoutes(protected)
		api.RegisterWalletRoutes(protected)
		api.RegisterSessionRoutes(protected)
		api.RegisterUsageRoutes(protected)
		api.RegisterCircleRoutes(protected)
		api.RegisterAnalyticsRoutes(protected)
		api.RegisterGeoRoutes(protected)
		api.Register2FARoutes(protected)    // 2FA management endpoints
		api.RegisterAPIKeyRoutes(protected) // API key management endpoints

		// Social Hub features
		api.RegisterProfileRoutes(protected)   // Profiles and follows
		api.RegisterListingRoutes(protected)   // Marketplace listings
		api.RegisterOrderRoutes(protected)     // Orders/purchases
		api.RegisterReviewRoutes(protected)    // Reviews and ratings
		api.RegisterMessagingRoutes(protected) // Direct messaging
		api.RegisterFeedRoutes(protected)      // Feed and discovery

		// Phase 10: New Features
		api.RegisterEscrowRoutes(protected)       // Escrow payments
		api.RegisterSubscriptionRoutes(protected) // Subscription plans
		api.RegisterBadgeRoutes(protected)        // Achievement badges

		// Phase 11: Remaining Features
		api.RegisterReferralRoutes(protected)     // Referral program
		api.RegisterFavoriteRoutes(protected)     // Favorites/watchlist
		api.RegisterSellerTierRoutes(protected)   // Seller tiers
		api.RegisterSavedSearchRoutes(protected)  // Saved searches
		api.RegisterTeamRoutes(protected)         // Team accounts
		api.RegisterIPAllowlistRoutes(protected)  // IP allowlist
		api.RegisterGDPRRoutes(protected)         // GDPR data export
		api.RegisterProviderNodeRoutes(protected) // Multi-node management

		// Final Features
		api.RegisterSmartMatchingRoutes(protected) // AI proxy matching
		api.RegisterForumRoutes(protected)         // Community forum
	}

	// Public 2FA verification endpoint (user has temp token, not full auth)
	public.POST("/auth/2fa/verify", api.Verify2FALogin)

	// Admin routes (auth + admin role required)
	admin := r.Group("/v1/admin")
	admin.Use(api.AuthMiddleware(), api.RequireRole("admin"))
	{
		// KYC Management
		admin.GET("/kyc/pending", api.GetPendingKycVerifications)
		admin.POST("/kyc/:id/approve", api.AdminApproveKyc)
		admin.POST("/kyc/:id/reject", api.AdminRejectKyc)

		// User, Node, Payout, Stats Management
		api.RegisterAdminRoutes(admin)

		// Health Monitoring
		api.RegisterHealthRoutes(admin)
	}

	// Start background health monitoring
	go func() {
		healthConfig := getHealthConfig()
		health.Start(healthConfig)
	}()

	log.Printf("Starting control-api on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Get allowed origins from environment or use defaults
		allowedOriginsEnv := os.Getenv("CORS_ORIGINS")
		var allowedOrigins []string
		if allowedOriginsEnv != "" {
			allowedOrigins = strings.Split(allowedOriginsEnv, ",")
		} else {
			// Default origins for development
			allowedOrigins = []string{
				"http://localhost:3000",
				"http://localhost:3001",
				"http://127.0.0.1:3000",
			}
		}

		origin := c.Request.Header.Get("Origin")

		// Check if origin is allowed
		allowed := false
		for _, o := range allowedOrigins {
			if strings.TrimSpace(o) == origin {
				allowed = true
				break
			}
		}

		if allowed {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		}

		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With, Proxy-Authorization")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE, PATCH")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

// getHealthConfig returns health monitoring configuration from environment or defaults
func getHealthConfig() health.Config {
	return health.DefaultConfig()
}
