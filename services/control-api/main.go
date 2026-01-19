package main

import (
	"log"
	"os"

	"github.com/gin-contrib/secure"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/proxyhubb/control-api/internal/api"
	"github.com/proxyhubb/control-api/internal/bittensor"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/indexer"
	"github.com/proxyhubb/control-api/internal/middleware"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/worker"
)

func main() {
	// Load environment variables from .env file
	if err := godotenv.Load(); err != nil {
		log.Printf("Warning: .env file not found or failed to load: %v", err)
	}

	// Load Config
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Initialize DB
	if err := db.Init(cfg.Database.DatabaseURL); err != nil {
		log.Fatalf("Failed to init DB: %v", err)
	}

	// Initialize Redis
	if err := redisClient.Init(); err != nil {
		log.Printf("Warning: Failed to init Redis: %v", err)
	}

	r := gin.Default()

	// Security Headers
	r.Use(secure.New(secure.Config{
		SSLRedirect:           false, // Handled by Ingress/LoadBalancer
		IsDevelopment:         os.Getenv("GIN_MODE") != "release",
		AllowedHosts:          []string{"api.proxyhubb.com"},
		STSSeconds:            315360000,
		STSIncludeSubdomains:  true,
		FrameDeny:             true,
		ContentTypeNosniff:    true,
		BrowserXssFilter:      true,
		ContentSecurityPolicy: "default-src 'self'",
		ReferrerPolicy:        "strict-origin-when-cross-origin",
	}))

	// CORS
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, UPDATE")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Expose-Headers", "Content-Length")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	// Metrics
	api.RegisterMetricsEndpoint(r)

	// Routes
	// v1: Optional Auth (Publicly accessible, but identifies user if token present)
	v1 := r.Group("/v1")
	v1.Use(middleware.SupabaseAuthMiddlewareOptional(cfg))
	{
		api.RegisterAuthRoutes(v1)
		api.RegisterListingRoutes(v1) // Mix of public/private
		api.RegisterFeedRoutes(v1)    // Mix of public/private (Discover)
		api.RegisterProfileRoutes(v1) // Public profiles
		api.RegisterPublicReviewRoutes(v1)
	}

	// Protected Routes (Require Authentication)
	protected := v1.Group("/")
	protected.Use(middleware.RequireAuth())
	{
		api.RegisterProviderNodeRoutes(protected)
		api.RegisterSessionRoutes(protected)
		api.RegisterWalletRoutes(protected)
		api.RegisterOrderRoutes(protected)
		api.RegisterEscrowRoutes(protected)
		api.RegisterUsageRoutes(protected)

		api.RegisterSmartMatchingRoutes(protected)
		api.RegisterGovernanceRoutes(protected)
		api.RegisterOnboardingRoutes(protected)
		api.RegisterBittensorRoutes(protected)
		api.RegisterCircleRoutes(protected)

		api.RegisterReferralRoutes(protected)
		api.RegisterSubscriptionRoutes(protected)
		api.RegisterForumRoutes(protected) // Mostly private (posting)
		api.RegisterMessagingRoutes(protected)

		api.RegisterProtectedReviewRoutes(protected)
		api.RegisterAgentRoutes(protected)
	}

	// Start Chain Indexer
	idx := indexer.NewIndexer()
	idx.Start()

	// Start Validator Sync
	btClient := bittensor.NewClient(cfg.Bittensor)
	worker.StartValidatorSync(btClient, cfg.Bittensor.NetUID)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	r.Run(":" + port)
}
