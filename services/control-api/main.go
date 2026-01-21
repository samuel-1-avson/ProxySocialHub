package main

import (
	"log"
	"os"
	"time"

	"github.com/gin-contrib/secure"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/proxyhubb/control-api/internal/api"
	"github.com/proxyhubb/control-api/internal/bittensor"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/indexer"
	"github.com/proxyhubb/control-api/internal/middleware"
	"github.com/proxyhubb/control-api/internal/monitoring"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
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

	// Initialize Solana Oracle (optional)
	if err := solanaClient.InitOracleFromEnv(); err != nil {
		log.Printf("Warning: Failed to init Solana oracle: %v", err)
	}

	// Initialize Solana Event Watcher (optional)
	rpcEndpoint := os.Getenv("SOLANA_RPC_ENDPOINT")
	if rpcEndpoint == "" {
		rpcEndpoint = "https://api.devnet.solana.com"
	}
	wsEndpoint := os.Getenv("SOLANA_WS_ENDPOINT")
	if wsEndpoint == "" {
		wsEndpoint = "wss://api.devnet.solana.com"
	}

	if err := solanaClient.InitWatcher(solanaClient.WatcherConfig{
		RPCEndpoint:  rpcEndpoint,
		WSEndpoint:   wsEndpoint,
		PollInterval: 30 * time.Second,
	}); err != nil {
		log.Printf("Warning: Failed to init Solana watcher: %v", err)
	} else {
		solanaClient.InitSessionActivator()
		solanaClient.RegisterSessionActivatorWithWatcher()
		solanaClient.StartWatcher()
	}

	r := gin.Default()

	// Security Headers
	r.Use(secure.New(secure.Config{
		SSLRedirect:           false, // Handled by Ingress/LoadBalancer
		IsDevelopment:         os.Getenv("GIN_MODE") != "release",
		AllowedHosts:          []string{"api.proxyhubb.com", "localhost", "127.0.0.1", "*.trycloudflare.com"},
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
		origin := c.Request.Header.Get("Origin")
		allowOrigin := ""

		// Check if origin is allowed
		for _, o := range cfg.Server.CORSOrigins {
			if o == origin {
				allowOrigin = origin
				break
			}
		}

		// Fallback for tools/Postman if no origin (or if we want to allow dev tools in dev mode)
		if allowOrigin == "" && cfg.Server.Environment == "development" {
			// allowOrigin = "*" // Still unsafe with credentials, better to not set or require origin
		}

		if allowOrigin != "" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", allowOrigin)
		}

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

	// Metrics Middleware (record all requests)
	r.Use(monitoring.MetricsMiddleware())

	// Metrics and Monitoring Endpoints
	monitoring.RegisterMetricsRoutes(r)
	api.RegisterMetricsEndpoint(r)

	// Public / Health
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// v1: Optional Auth (Publicly accessible, but identifies user if token present)
	v1 := r.Group("/v1")
	v1.Use(middleware.SupabaseAuthMiddlewareOptional(cfg))
	{
		api.RegisterHealthRoutes(v1)
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
		api.RegisterLinkedWalletRoutes(protected)
		api.RegisterForumRoutes(protected) // Mostly private (posting)
		api.RegisterMessagingRoutes(protected)
		api.RegisterFriendRoutes(protected)

		api.RegisterProtectedReviewRoutes(protected)
		api.RegisterAgentRoutes(protected)
		api.RegisterAgentRegistryRoutes(protected)
		api.RegisterSubtensorRoutes(protected)

		// Analytics & Geo
		api.RegisterAnalyticsRoutes(protected)
		api.RegisterGeoRoutes(protected)

		// Proxy Engine Services (Phase 16)
		api.RegisterProviderServicesRoutes(protected)
		api.RegisterServiceDiscoveryRoutes(protected)

		// Trustless Proofs (Phase 17)
		api.RegisterTrustlessRoutes(protected)

		// Quality Attestation (Phase 18)
		api.RegisterValidatorRoutes(protected)

		// Decentralized Disputes (Phase 19)
		api.RegisterDisputeJuryRoutes(protected)

		// User Security (Phase 21)
		api.RegisterSecurityRoutes(protected)

		// Audit & Monitoring (Phase 22)
		api.RegisterAuditRoutes(protected)

		// Blockchain / Solana
		solanaClient.RegisterRoutes(protected)
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
