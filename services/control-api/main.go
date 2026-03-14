package main

import (
	"context"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-contrib/secure"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	solanaGo "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/api"
	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/core/services"
	"github.com/proxyhubb/control-api/internal/db"
	gatewayPkg "github.com/proxyhubb/control-api/internal/gateway"
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
	log.Printf("Loaded CORS Origins: %v", cfg.Server.CORSOrigins)

	// Initialize DB
	if err := db.Init(cfg.Database.DatabaseURL); err != nil {
		log.Fatalf("Failed to init DB: %v", err)
	}
	db.SeedAll()

	// Initialize Redis
	if err := redisClient.Init(); err != nil {
		log.Printf("Warning: Failed to init Redis: %v", err)
	}

	// Initialize Config Manager (Redis + DB Sync)
	cm := config.NewConfigManager(redisClient.Client, db.DB)
	if err := cm.RefreshAll(); err != nil {
		log.Printf("Warning: Failed to sync DB configs to Redis: %v", err)
	}
	api.InitConfigManager(cm)
	log.Println("Internal Config Manager initialized and synced")

	// Initialize Admin Config (3 hardcoded admin accounts)
	api.InitAdminConfig(&cfg.Admin)
	log.Println("Admin config initialized")

	// Initialize Agent Dispatcher (Phase 13 Orchestration)
	ad := worker.NewAgentTaskDispatcher()
	api.InitAgentDispatcher(ad)
	log.Println("AI Agent Orchestration Dispatcher initialized")

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

	// --- Solana Initialization (Phase 5 Infrastructure) ---
	endpointsStr := os.Getenv("SOLANA_RPC_ENDPOINTS")
	var rpcEndpoints []string
	if endpointsStr != "" {
		rpcEndpoints = strings.Split(endpointsStr, ",")
		for i := range rpcEndpoints {
			rpcEndpoints[i] = strings.TrimSpace(rpcEndpoints[i])
		}
	} else {
		rpcEndpoint := os.Getenv("SOLANA_RPC_ENDPOINT")
		if rpcEndpoint == "" {
			rpcEndpoint = "https://api.devnet.solana.com"
		}
		rpcEndpoints = []string{rpcEndpoint}
	}

	wsEndpoint := os.Getenv("SOLANA_WS_ENDPOINT")
	if wsEndpoint == "" {
		wsEndpoint = "wss://api.devnet.solana.com"
	}

	// 1. Initialize Global Oracle (API Handlers)
	if err := solanaClient.InitOracleFromEnv(); err != nil {
		log.Printf("Warning: Failed to init Solana oracle: %v", err)
	}

	// 2. Initialize Event Watcher
	if err := solanaClient.InitWatcher(solanaClient.WatcherConfig{
		RPCEndpoints: rpcEndpoints,
		WSEndpoint:   wsEndpoint,
		TreasuryAddr: os.Getenv("SOLANA_TREASURY_ADDRESS"),
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

	// CORS (Robust for Hybrid Dev Environments)
	r.Use(func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		allowOrigin := ""

		// Trim any whitespace
		origin = strings.TrimSpace(origin)

		// 1. Check Whitelist
		for _, o := range cfg.Server.CORSOrigins {
			if strings.TrimSpace(o) == origin {
				allowOrigin = origin
				break
			}
		}

		// 2. Fallback: Allow all in development mode
		if allowOrigin == "" && os.Getenv("GO_ENV") == "development" {
			allowOrigin = origin // Reflect back for DevEase
		}

		if allowOrigin != "" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", allowOrigin)
		} else {
			// Even if blocked, set a debug header for the user
			c.Writer.Header().Set("X-ProxyHub-CORS", "Blocked-Origin-"+origin)
		}

		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, UPDATE, PATCH")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With, X-Session-ID, X-User-ID")
		c.Writer.Header().Set("Access-Control-Expose-Headers", "Content-Length, X-Trace-ID, X-ProxyHub-CORS")
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
	// Allow additional IPs from environment variable (comma-separated)
	if additionalIPs := os.Getenv("WAF_WHITELIST_IPS"); additionalIPs != "" {
		ips := strings.Split(additionalIPs, ",")
		for _, ip := range ips {
			ip = strings.TrimSpace(ip)
			if ip != "" {
				wafConfig.WhitelistedIPs = append(wafConfig.WhitelistedIPs, ip)
			}
		}
	}
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
		api.RegisterReputationRoutes(v1) // Phase 9.2 Trust Layer
		api.RegisterExplorerRoutes(v1)      // System Explorer (Public blockchain explorer)
		api.RegisterExplorerWSRoutes(v1)    // Explorer WebSocket for real-time updates
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
		api.RegisterCircleRoutes(protected)

		api.RegisterReferralRoutes(protected)
		api.RegisterSubscriptionRoutes(protected)
		api.RegisterLinkedWalletRoutes(protected)
		api.RegisterForumRoutes(protected) // Mostly private (posting)
		api.RegisterMessagingRoutes(protected)
		api.RegisterFriendRoutes(protected)
		api.RegisterNotificationRoutes(protected)
		api.RegisterShowcaseRoutes(protected)
		api.RegisterWebSocketRoutes(protected) // WebSocket for real-time updates

		api.RegisterProtectedReviewRoutes(protected)
		api.RegisterAgentRoutes(protected)
		api.RegisterAgentRegistryRoutes(protected)
		// Analytics & Geo
		api.RegisterAnalyticsRoutes(protected)
		api.RegisterGeoRoutes(protected)

		// Proxy Engine Services (Phase 16)
		api.RegisterProviderServicesRoutes(protected)
		api.RegisterServiceDiscoveryRoutes(protected)

		// Trustless Proofs (Phase 17)
		api.RegisterTrustlessRoutes(protected)

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

		// Phase 4: Real-time session stream (SSE)
		api.RegisterSessionStreamRoutes(protected)

		// Bulk Proxy API (Phase 5)
		api.RegisterBulkRoutes(protected)

		// Provider Verification Tiers (Phase 6)
		api.RegisterTierRoutes(protected)
	}

	// ======== Admin Panel Routes ========
	// Completely separate auth — signed with ADMIN_JWT_SECRET, not user JWT_SECRET.
	// Only the 3 hardcoded admin accounts can authenticate here.
	adminGroup := r.Group("/v1/admin")
	{
		// Public admin auth (no middleware)
		adminAuth := adminGroup.Group("/auth")
		api.RegisterAdminAuthRoutes(adminAuth)

		// SSE stream — validates admin token via ?token= query param (EventSource can't set headers)
		api.RegisterAdminSessionStreamRoute(adminGroup, cfg)

		// Protected admin routes (require valid admin JWT)
		adminProtected := adminGroup.Group("/")
		adminProtected.Use(middleware.AdminAuthMiddleware(cfg))
		{
			api.RegisterAdminMeRoute(adminProtected.Group("/auth"))

			// Core admin operations (user mgmt, nodes, payouts, stats, audit)
			// AdminAuthMiddleware already sets userRole="admin" so RequirePermission works.
			admin := adminProtected.Group("/")
			api.RegisterAdminRoutes(admin)
			api.RegisterAdminExtendedRoutes(admin)
		}
	}
	log.Println("Admin panel routes registered at /v1/admin")

	// Start Chain Indexer
	idx := indexer.NewIndexer()
	idx.Start()

	// Initialize Explorer WebSocket Hub
	api.InitExplorerHub()

	// Start Blockchain Explorer Indexer (indexes blocks and transactions)
	if os.Getenv("EXPLORER_INDEXER_ENABLED") != "false" {
		programID := os.Getenv("SOLANA_PROGRAM_ID")
		if programID == "" {
			programID = "CVHGJx11kuEc4xD4vR6ey6W9wFXRpzUs7kChTK2E4QqD" // Default devnet program
		}

		rpcEndpoint := os.Getenv("SOLANA_RPC_ENDPOINT")
		if rpcEndpoint == "" {
			rpcEndpoint = "https://api.devnet.solana.com"
		}

		pollInterval := 400 * time.Millisecond
		if interval := os.Getenv("EXPLORER_INDEXER_POLL_INTERVAL_MS"); interval != "" {
			if ms, err := strconv.Atoi(interval); err == nil {
				pollInterval = time.Duration(ms) * time.Millisecond
			}
		}

		blockchainIndexer, err := indexer.NewBlockchainIndexer(indexer.IndexerConfig{
			RPCEndpoint:  rpcEndpoint,
			ProgramID:    programID,
			PollInterval: pollInterval,
			BatchSize:    100,
		})
		if err != nil {
			log.Printf("Warning: Failed to init Blockchain Indexer: %v", err)
		} else {
			blockchainIndexer.Start()
			log.Println("Blockchain Explorer Indexer started")
			
			// Register contracts
			registry := indexer.NewContractRegistry()
			treasuryAddr := os.Getenv("SOLANA_TREASURY_ADDRESS")
			if err := registry.RegisterProxyHubbContracts(programID, treasuryAddr); err != nil {
				log.Printf("Warning: Failed to register contracts: %v", err)
			}
		}

		// Start Node Sync Service
		nodeSyncInterval := 5 * time.Minute
		if interval := os.Getenv("NODE_SYNC_INTERVAL_MINUTES"); interval != "" {
			if mins, err := strconv.Atoi(interval); err == nil {
				nodeSyncInterval = time.Duration(mins) * time.Minute
			}
		}

		nodeSync := indexer.NewNodeSync(indexer.NodeSyncConfig{
			Interval: nodeSyncInterval,
		})
		nodeSync.Start()
		log.Println("Node Sync Service started")
	}

	// Start Governance Proposal Worker
	governance.ScheduleProposalWorker()

	// Initialize Marketplace Core (Phase 9 Hexagonal Architecture)
	marketRepo := db.NewMarketplaceRepository()
	marketService := services.NewMarketplaceService(marketRepo)
	api.InitMarketplaceService(marketService)
	log.Println("Marketplace Core Service initialized")

	// Start Liquidity Manager (Phase 5.2)
	oracleConfig := solanaClient.Config{
		RPCEndpoints:      rpcEndpoints,
		OracleKeypairPath: os.Getenv("SOLANA_ORACLE_KEYPAIR"),
		Network:           "devnet",
	}
	if oracleConfig.OracleKeypairPath == "" {
		oracleConfig.OracleKeypairPath = "oracle-keypair.json"
	}

	// Try to load oracle client, but don't crash if keypair missing (dev mode)
	if oracleClient, err := solanaClient.NewOracleClient(oracleConfig); err == nil {
		solanaClient.InitStakingService(oracleClient)
		solanaClient.InitProofService(oracleClient)

		// Wire live SOL transfer into the billing package for provider payouts
		billing.SetSOLTransferFunc(func(ctx context.Context, recipient string, amountSOL float64) error {
			recipientKey, err := solanaGo.PublicKeyFromBase58(recipient)
			if err != nil {
				return err
			}
			lamports := solanaClient.SOLToLamports(amountSOL)
			_, err = oracleClient.SendSOL(ctx, recipientKey, lamports)
			return err
		})
		billing.StartSettlementWorker()
		billing.StartPayoutRetryWorker()
		log.Println("Payout retry worker started")

		lm := treasury.NewLiquidityManager(oracleClient)
		lm.StartRebalanceLoop(context.Background(), 1*time.Hour)

		// Start Escrow Cleaner (Phase 6 - Reliability)
		cleaner := worker.NewEscrowCleaner(oracleClient)
		cleaner.Start(context.Background(), 30*time.Minute)

		wt := treasury.NewWatchtower()
		gp := treasury.NewGhostProber(wt)
		gp.StartProbingLoop(context.Background(), 5*time.Minute)

		// Start Automated Settlement Aggregator (Phase 14)
		sa := worker.NewSettlementAggregator(oracleClient, 1*time.Hour)
		go sa.Start(context.Background())

		log.Println("Liquidity Manager, Ghost Prober, Staking, Proof and Settlement services started")
	} else {
		log.Printf("Skipping Liquidity Manager: %v", err)
	}

	// Start ZK-Settlement Worker (Phase 8 Asynchronous Confidential Settlement)
	zkWorker := worker.NewZKSettlementWorker()
	zkWorker.Start(context.Background())
	log.Println("ZK-Settlement Worker started")

	// Start Marketplace Watcher (Phase 9.1 Real-time Telemetry)
	mw := worker.NewMarketplaceWatcher()
	if err := mw.Start(context.Background()); err != nil {
		log.Printf("Failed to start Marketplace Watcher: %v", err)
	}

	// Start Provisioning Worker (Phase 5.2 Event-Driven)
	sessionRepo := db.NewSessionRepository()
	redisGateway := gatewayPkg.NewRedisGateway()
	pw := worker.NewProvisioningWorker(sessionRepo, redisGateway)
	if err := pw.Start(context.Background()); err != nil {
		log.Printf("Failed to start Provisioning Worker: %v", err)
	}

	// Start On-Chain Registry Sync Worker (Phase 9.3 Lifecycle Integrity)
	rw := indexer.NewRegistrySyncWorker(5 * time.Minute)
	go rw.Start(context.Background())
	log.Println("Registry Sync Worker started")

	// Start AI Agent Worker (Phase 13 Orchestration)
	aw := worker.NewAgentWorker()
	go aw.Start(context.Background())
	log.Println("AI Agent Execution Worker started")

	// Start All Background Workers (Phase 17 Reliability)
	worker.StartAll(nil) // nil queue as placeholder or use internal queue

	// Start Provider Tier Evaluator (Phase 6)
	worker.StartTierEvaluator()
	log.Println("Provider Tier Evaluator started")

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	r.Run(":" + port)
}
