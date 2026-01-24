package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gin-contrib/secure"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/proxyhubb/control-api/internal/api"
	"github.com/proxyhubb/control-api/internal/bittensor"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/governance"
	"github.com/proxyhubb/control-api/internal/indexer"
	"github.com/proxyhubb/control-api/internal/middleware"
	"github.com/proxyhubb/control-api/internal/monitoring"
	internalNats "github.com/proxyhubb/control-api/internal/nats"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/treasury"
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
	db.SeedAll()

	// Initialize Redis
	if err := redisClient.Init(); err != nil {
		log.Printf("Warning: Failed to init Redis: %v", err)
	}

	// Initialize NATS (Event Driven Evolution)
	if err := internalNats.Init(); err != nil {
		log.Printf("Warning: Failed to init NATS: %v", err)
	} else {
		defer internalNats.Close()
	}

	// Initialize OpenTelemetry Tracing
	tracingConfig := middleware.DefaultTracingConfig()
	if os.Getenv("GIN_MODE") == "release" {
		tracingConfig = middleware.ProductionTracingConfig()
	}
	if jaegerEndpoint := os.Getenv("JAEGER_ENDPOINT"); jaegerEndpoint != "" {
		tracingConfig.JaegerEndpoint = jaegerEndpoint
	}
	if otlpEndpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"); otlpEndpoint != "" {
		tracingConfig.OTLPEndpoint = otlpEndpoint
	}
	tracingCleanup, err := middleware.InitTracing(tracingConfig)
	if err != nil {
		log.Printf("Warning: Failed to init tracing: %v", err)
	} else {
		defer tracingCleanup()
		log.Println("OpenTelemetry tracing initialized")
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
		worker.RegisterEscrowEventListener()
	}

	r := gin.Default()

	// CORS (Must be first to handle preflight requests properly even if WAF blocks later)
	r.Use(func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		allowOrigin := ""

		// Trim any whitespace from the received origin
		origin = strings.TrimSpace(origin)

		// Check if origin is allowed
		for _, o := range cfg.Server.CORSOrigins {
			if strings.TrimSpace(o) == origin {
				allowOrigin = origin
				break
			}
		}

		if allowOrigin != "" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", allowOrigin)
		} else if origin != "" {
			// Diagnostic log for CORS issues in dev
			if cfg.Server.Environment == "development" {
				// Log to standard output as well for visibility in Docker logs
				log.Printf("CORS mismatch: received origin %q, allowed origins: %v", origin, cfg.Server.CORSOrigins)
			}
		}

		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, UPDATE, PATCH")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Expose-Headers", "Content-Length, X-Trace-ID")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	// Health endpoint BEFORE security middleware (for Docker healthchecks)
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Emergency Circuit Breaker (Industrial Security)
	r.Use(middleware.EmergencyBreaker())

	// OpenTelemetry Tracing Middleware (early for full request coverage)
	r.Use(middleware.TracingMiddleware("proxyhubb-control-api"))

	// WAF & DDoS Protection (before other middleware)
	wafConfig := middleware.DefaultWAFConfig()
	r.Use(middleware.WAFMiddleware(wafConfig))
	r.Use(middleware.DDoSProtectionMiddleware(middleware.DefaultDDoSConfig()))

	// Security Headers
	r.Use(secure.New(secure.Config{
		SSLRedirect:           false, // Handled by Ingress/LoadBalancer
		IsDevelopment:         os.Getenv("GIN_MODE") != "release",
		AllowedHosts:          []string{}, // Empty = allow all hosts
		STSSeconds:            315360000,
		STSIncludeSubdomains:  true,
		FrameDeny:             true,
		ContentTypeNosniff:    true,
		BrowserXssFilter:      true,
		ContentSecurityPolicy: "default-src 'self'",
		ReferrerPolicy:        "strict-origin-when-cross-origin",
	}))

	// Metrics Middleware (record all requests)
	r.Use(monitoring.MetricsMiddleware())

	// Circuit Breaker Middleware for external services
	r.Use(middleware.CircuitBreakerMiddleware("database", middleware.DefaultCircuitBreakerConfigs["database"]))
	r.Use(middleware.CircuitBreakerMiddleware("redis", middleware.DefaultCircuitBreakerConfigs["redis"]))
	r.Use(middleware.CircuitBreakerMiddleware("solana", middleware.DefaultCircuitBreakerConfigs["solana"]))
	r.Use(middleware.CircuitBreakerMiddleware("supabase", middleware.DefaultCircuitBreakerConfigs["supabase"]))

	// Metrics and Monitoring Endpoints
	monitoring.RegisterMetricsRoutes(r)

	// Circuit Breaker Stats Endpoint
	r.GET("/metrics/circuit-breakers", middleware.CircuitBreakerStatsHandler())

	// v1: Optional Auth (Publicly accessible, but identifies user if token present)
	v1 := r.Group("/v1")
	v1.Use(middleware.SupabaseAuthMiddlewareOptional(cfg))
	{
		api.RegisterHealthRoutes(v1)
		api.RegisterMonitoringRoutes(v1)
		api.RegisterAuthRoutes(v1)
		api.RegisterListingRoutes(v1) // Mix of public/private
		api.RegisterFeedRoutes(v1)    // Mix of public/private (Discover)
		api.RegisterProfileRoutes(v1) // Public profiles
		api.RegisterPublicReviewRoutes(v1)
		api.RegisterSystemRoutes(v1)
	}

	// Protected Routes (Require Authentication)
	protected := v1.Group("/")
	protected.Use(middleware.RequireAuth())
	{
		api.RegisterProviderNodeRoutes(protected)
		api.RegisterSessionRoutes(protected)
		api.RegisterWalletRoutes(protected)
		api.RegisterStakingRoutes(protected)
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

		// State Channels (Phase 5)
		api.RegisterChannelRoutes(protected)

		// Blockchain / Solana
		solanaClient.RegisterRoutes(protected)
	}

	// Start Chain Indexer
	idx := indexer.NewIndexer()
	idx.Start()

	// Start Validator Sync
	btClient := bittensor.NewClient(cfg.Bittensor)
	api.InitBittensorClient(btClient) // Initialize singleton for handlers
	worker.StartValidatorSync(btClient, cfg.Bittensor.NetUID)

	// Start Governance Proposal Worker
	governance.ScheduleProposalWorker()

	// Start Liquidity Manager (Phase 5.2)
	// Needs authentic Oracle Client instance, not just global init
	oracleConfig := solanaClient.Config{
		RPCEndpoint:       os.Getenv("SOLANA_RPC_ENDPOINT"),
		OracleKeypairPath: os.Getenv("ORACLE_KEYPAIR_PATH"),
		Network:           "devnet",
	}
	// Defaults if empty
	if oracleConfig.RPCEndpoint == "" {
		oracleConfig.RPCEndpoint = "https://api.devnet.solana.com"
	}
	if oracleConfig.OracleKeypairPath == "" {
		oracleConfig.OracleKeypairPath = "oracle-keypair.json"
	}

	// Try to load oracle client, but don't crash if keypair missing (dev mode)
	if oracleClient, err := solanaClient.NewOracleClient(oracleConfig); err == nil {
		lm := treasury.NewLiquidityManager(oracleClient, &treasury.MockJupiterClient{})
		lm.StartRebalanceLoop(context.Background(), 1*time.Hour)
		log.Println("Liquidity Manager started")
	} else {
		log.Printf("Skipping Liquidity Manager: %v", err)
	}

	// Start Provisioning Worker (Phase 5.2 Event-Driven)
	// We need a dummy or existing repo implementation for this demo refactor
	// In full hexagonal, we use the secondary adapter Implementation
	pw := worker.NewProvisioningWorker(nil, nil) // Dependencies passed in real impl
	if err := pw.Start(context.Background()); err != nil {
		log.Printf("Failed to start Provisioning Worker: %v", err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	r.Run(":" + port)
}
