package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	solanaGo "github.com/gagliardetto/solana-go"
	"github.com/gin-contrib/secure"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/proxyhubb/control-api/internal/alerts"
	"github.com/proxyhubb/control-api/internal/api"
	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/core/services"
	cryptoPkg "github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	gatewayPkg "github.com/proxyhubb/control-api/internal/gateway"
	"github.com/proxyhubb/control-api/internal/gateways"
	"github.com/proxyhubb/control-api/internal/gov"
	"github.com/proxyhubb/control-api/internal/governance"
	"github.com/proxyhubb/control-api/internal/health"
	"github.com/proxyhubb/control-api/internal/indexer"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/middleware"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/monitoring"
	internalNats "github.com/proxyhubb/control-api/internal/nats"
	"github.com/proxyhubb/control-api/internal/ops"
	"github.com/proxyhubb/control-api/internal/pricing"
	"github.com/proxyhubb/control-api/internal/providergate"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/sessioncache"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/treasury"
	"github.com/proxyhubb/control-api/internal/worker"
)

func main() {
	// Load environment variables from ignored local overrides first, then the tracked template.
	// godotenv does not override existing values, so .env.local wins over .env.
	if err := godotenv.Load(".env.local", ".env"); err != nil {
		log.Printf("Warning: env files not found or failed to load: %v", err)
	}

	// Structured logger must init before alerts / workers (zerolog nop otherwise).
	logging.Init()

	// Initialise platform-native alerts (durable journal + NATS; no Slack/PagerDuty)
	alerts.Init()

	// Fail-closed guards: never allow dev financial escapes in production.
	appEnv := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if appEnv == "production" || appEnv == "prod" {
		if strings.EqualFold(strings.TrimSpace(os.Getenv("ALLOW_UNSIGNED_USAGE")), "true") {
			log.Fatal("FATAL: ALLOW_UNSIGNED_USAGE=true is forbidden in production (usage signing must be enforced)")
		}
		for _, devFlag := range []string{
			"PROXYHUB_ALLOW_DEV_ESCROW_ACTIVATE",
			"PROXYHUB_ALLOW_DEV_LISTING_SIGN",
			"PROXYHUB_ALLOW_DEV_BYPASS",
		} {
			if strings.EqualFold(strings.TrimSpace(os.Getenv(devFlag)), "true") {
				log.Fatalf("FATAL: %s=true is forbidden in production", devFlag)
			}
		}
	}
	if v := strings.TrimSpace(os.Getenv("REQUIRE_PROVIDER_LEASE")); v != "" {
		if (appEnv == "production" || appEnv == "prod") && !strings.EqualFold(v, "true") {
			log.Fatal("FATAL: REQUIRE_PROVIDER_LEASE must be true in production")
		}
	}

	// Load Config
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	api.InitGatewayEndpoints(cfg.Gateway)
	log.Printf("Buyer proxy endpoint: %s", cfg.Gateway.BuyerProxyEndpoint())
	log.Printf("Loaded CORS Origins: %v", cfg.Server.CORSOrigins)

	// Initialize DB
	if err := db.Init(cfg.Database.DatabaseURL); err != nil {
		log.Fatalf("Failed to init DB: %v", err)
	}
	db.SeedAll()

	// One-shot recovery: credit stuck on-chain deposits that failed ledger dual-write.
	// RECREDIT_DEPOSITS=sig:lamports,sig:lamports  RECREDIT_DRY_RUN=true (optional)
	if raw := strings.TrimSpace(os.Getenv("RECREDIT_DEPOSITS")); raw != "" {
		dry := strings.EqualFold(strings.TrimSpace(os.Getenv("RECREDIT_DRY_RUN")), "true")
		trust := strings.EqualFold(strings.TrimSpace(os.Getenv("RECREDIT_TRUST_CLI")), "true")
		if err := ops.RecreditDepositsOpts(raw, dry, trust); err != nil {
			log.Fatalf("RECREDIT_DEPOSITS failed: %v", err)
		}
		log.Println("RECREDIT_DEPOSITS complete — exiting")
		return
	}

	// MIGRATE_ONLY mode: run schema migrations (+ optional credential encryption) then exit.
	// Used by the db-migrate init container in Docker Compose.
	if os.Getenv("MIGRATE_ONLY") == "true" {
		// Wire encryption so MIGRATE_CREDENTIALS works in this mode
		models.CredentialEncryptFn = cryptoPkg.Encrypt
		models.CredentialDecryptFn = cryptoPkg.Decrypt
		if os.Getenv("MIGRATE_CREDENTIALS") == "true" {
			svc := cryptoPkg.NewCredentialService()
			migrated, errs := svc.MigrateExistingCredentials()
			log.Printf("Credential migration complete: %d migrated, %d errors", migrated, len(errs))
			for _, e := range errs {
				log.Printf("  credential migration error: %v", e)
			}
		}
		if os.Getenv("MIGRATE_TAX_IDS") == "true" {
			migrated, errs := models.MigratePlaintextTaxIDs(db.DB)
			log.Printf("Tax ID migration complete: %d migrated, %d errors", migrated, len(errs))
			for _, e := range errs {
				log.Printf("  tax_id migration error: %v", e)
			}
		}
		if pepper, src := cryptoPkg.ResolveEmailHashPepper(); pepper != "" {
			models.EmailHashFn = cryptoPkg.NewEmailHashFn(pepper)
			log.Printf("Email hash HMAC registered (source=%s) for MIGRATE_ONLY", src)
		}
		if os.Getenv("MIGRATE_EMAILS") == "true" {
			migrated, errs := models.MigrateEmailsToVault(db.DB)
			log.Printf("Email vault migration complete: %d migrated, %d errors", migrated, len(errs))
			for _, e := range errs {
				log.Printf("  email vault migration error: %v", e)
			}
		}
		log.Println("MIGRATE_ONLY=true — schema migration complete, exiting.")
		os.Exit(0)
	}

	// Initialize read replica (no-op if READ_REPLICA_URL is not set — falls back to primary)
	if err := db.InitReadReplica(); err != nil {
		log.Printf("Warning: read replica init failed: %v", err)
	}

	// --- Wire credential encryption into the Session model ---
	// Must run after crypto package is ready (ENCRYPTION_KEY is loaded via config.Load).
	// The function-variable approach avoids an import cycle between models ↔ crypto.
	if err := cryptoPkg.InitEncryption(); err != nil {
		log.Fatalf("ENCRYPTION_KEY required for marketplace session credentials: %v", err)
	}
	models.CredentialEncryptFn = cryptoPkg.Encrypt
	models.CredentialDecryptFn = cryptoPkg.Decrypt
	log.Println("Session credential encryption hooks registered")

	// Wave 5.B: seed J2 logical gateway operators into discovery registry.
	if err := gateways.SeedFromEnv(); err != nil {
		log.Printf("Warning: gateway operator seed failed: %v", err)
	} else {
		log.Println("Gateway operator discovery seed checked (ADR-0007)")
	}

	// --- Wire provider token hashing into the ProviderToken model ---
	// Uses HMAC-SHA256 keyed by TOKEN_HMAC_SECRET so hashes are useless without the key.
	tokenHMACSecret := os.Getenv("TOKEN_HMAC_SECRET")
	if err := cryptoPkg.ValidateTokenHMACSecret(tokenHMACSecret); err != nil {
		log.Fatalf("Invalid TOKEN_HMAC_SECRET: %v", err)
	}
	models.TokenHashFn = cryptoPkg.NewTokenHashFn(tokenHMACSecret)
	log.Println("Provider token HMAC hashing registered")

	if pepper, src := cryptoPkg.ResolveEmailHashPepper(); pepper != "" {
		if len(pepper) < 32 {
			log.Fatalf("Email hash pepper too short (%d chars); minimum 32", len(pepper))
		}
		models.EmailHashFn = cryptoPkg.NewEmailHashFn(pepper)
		log.Printf("Email hash HMAC registered (source=%s)", src)
	} else {
		log.Println("WARNING: EMAIL_HASH_PEPPER unset — email_hash lookups disabled until configured")
	}

	// One-time data migration: encrypt existing plaintext credentials in the sessions table.
	// Set MIGRATE_CREDENTIALS=true on a single pod/job; revert to false after completion.
	if os.Getenv("MIGRATE_CREDENTIALS") == "true" {
		svc := cryptoPkg.NewCredentialService()
		migrated, errs := svc.MigrateExistingCredentials()
		log.Printf("Credential migration complete: %d migrated, %d errors", migrated, len(errs))
		for _, e := range errs {
			log.Printf("  credential migration error: %v", e)
		}
	}

	// One-time: encrypt plaintext profiles.tax_id (PII-01). Set MIGRATE_TAX_IDS=true once.
	if os.Getenv("MIGRATE_TAX_IDS") == "true" {
		migrated, errs := models.MigratePlaintextTaxIDs(db.DB)
		log.Printf("Tax ID migration complete: %d migrated, %d errors", migrated, len(errs))
		for _, e := range errs {
			log.Printf("  tax_id migration error: %v", e)
		}
	}

	// One-time: move profiles.email (+ tax_id) into profile_private vault (Phase D).
	if os.Getenv("MIGRATE_EMAILS") == "true" {
		migrated, errs := models.MigrateEmailsToVault(db.DB)
		log.Printf("Email vault migration complete: %d migrated, %d errors", migrated, len(errs))
		for _, e := range errs {
			log.Printf("  email vault migration error: %v", e)
		}
	}

	// The proxy username (credentials_user) is stored in plaintext so it can be looked up
	// by equality; only the password is encrypted. Rewrite any legacy "ENC:" usernames.
	// Idempotent, so it runs on every start. Rows written by an older pod during a rolling
	// deploy are picked up on the next start.
	if migrated, errs := models.MigrateEncryptedSessionUsernames(db.DB); migrated > 0 || len(errs) > 0 {
		log.Printf("Session username migration: %d rewritten as plaintext, %d errors", migrated, len(errs))
		for _, e := range errs {
			log.Printf("  session username migration error: %v", e)
		}
	}

	// --- P0.2: Block startup if plaintext session passwords still exist ---
	// Encrypted passwords carry the "ENC:" prefix. A session password without it means
	// MIGRATE_CREDENTIALS was never run (or encryption was off when the row was written).
	if os.Getenv("SKIP_CREDENTIAL_CHECK") != "true" {
		var unencryptedCount int64
		db.DB.Raw(`
			SELECT COUNT(*) FROM sessions
			WHERE deleted_at IS NULL
			  AND credentials_pass IS NOT NULL
			  AND credentials_pass <> ''
			  AND credentials_pass NOT LIKE 'ENC:%'
		`).Scan(&unencryptedCount)
		if unencryptedCount > 0 {
			log.Fatalf(
				"SECURITY BLOCK: %d active session(s) have unencrypted passwords. "+
					"Re-run with MIGRATE_CREDENTIALS=true to encrypt them, then restart normally. "+
					"Set SKIP_CREDENTIAL_CHECK=true only in non-production environments.",
				unencryptedCount,
			)
		}
		log.Println("Credential encryption check passed — all active session passwords encrypted")
	}

	// Social tables use the same local PostgreSQL instance as the main DB.
	// InitSocial is a no-op when the DSN is empty (Supabase removed).
	if err := db.InitSocial(""); err != nil {
		log.Printf("Warning: social DB init failed: %v", err)
	}

	// Initialize Redis
	if err := redisClient.Init(); err != nil {
		log.Printf("Warning: Failed to init Redis: %v", err)
	}
	// Sprint J0: dual-write Redis session blobs to PG for edge hydrate on miss.
	redisClient.AfterStoreSession = func(username string, data *redisClient.SessionData, ttl time.Duration) {
		if err := sessioncache.Upsert(username, data, ttl); err != nil {
			logging.Warn().Err(err).Str("username", username).Msg("session_gateway_cache upsert failed")
		}
	}
	redisClient.AfterDeleteSession = func(username string) {
		if err := sessioncache.DeleteByUsername(username); err != nil {
			logging.Warn().Err(err).Str("username", username).Msg("session_gateway_cache delete failed")
		}
	}
	// Wave 3.1 / DISC-01: on-chain ProviderRegistry gate for session activation.
	marketplace.ProviderRegistryGateHook = providergate.Check
	api.LogRateLimitBackend()

	// Initialize Config Manager (Redis + DB Sync)
	cm := config.NewConfigManager(redisClient.Client, db.DB)
	if err := cm.RefreshAll(); err != nil {
		log.Printf("Warning: Failed to sync DB configs to Redis: %v", err)
	}
	api.InitConfigManager(cm)
	log.Println("Internal Config Manager initialized and synced")

	// Initialize Agent Dispatcher (Phase 13 Orchestration)
	ad := worker.NewAgentTaskDispatcher()
	api.InitAgentDispatcher(ad)
	log.Println("AI Agent Orchestration Dispatcher initialized")

	// Initialize NATS (Event Driven Evolution)
	if err := internalNats.Init(); err != nil {
		log.Printf("Warning: Failed to init NATS: %v", err)
	} else {
		defer internalNats.Close()
		internalNats.StartConsumerLagScraper(30 * time.Second)
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
	rpcEndpoints := solanaClient.RPCEndpointsFromEnv()
	rpcEndpoints = solanaClient.HealthyRPCEndpoints(context.Background(), rpcEndpoints)
	wsEndpoint := solanaClient.WSEndpointFromEnv(rpcEndpoints)
	log.Printf("Solana RPC endpoints configured: %d", len(rpcEndpoints))

	// 1. Initialize Global Oracle (API Handlers)
	// On gcp-testnet, SOLANA_ORACLE_KEYPAIR is empty (KMS); the production oracle
	// is registered later via NewOracleClient + RegisterOracleClient (BC-06 multisig
	// init must follow that registration).
	if err := solanaClient.InitOracleFromEnv(); err != nil {
		log.Printf("Warning: Failed to init Solana oracle: %v", err)
	}

	// Initialize Treasury Auto-Topup Service
	treasury.SetColdToHotProposer(func(amountSOL float64, hotAddress string) (string, error) {
		id, err := gov.GetGovernor().ProposeColdToHot(hotAddress, amountSOL, "system")
		if err != nil {
			return "", err
		}
		return id.String(), nil
	})
	treasury.SetHotToColdProposer(func(amountSOL float64, coldAddress string) (string, error) {
		id, err := gov.GetGovernor().ProposeHotToCold(coldAddress, amountSOL, "system")
		if err != nil {
			return "", err
		}
		return id.String(), nil
	})
	treasuryManager := treasury.GetManager()
	worker.GoSupervised("TreasuryAutoTopupMonitor", 5*time.Second, func() {
		treasuryManager.StartAutoTopupMonitor(context.Background())
	})
	log.Println("Treasury auto-topup monitor started")
	worker.StartWithdrawalPayoutWorker(context.Background())
	log.Println("Withdrawal payout worker started")

	// Initialize Usage Milestone Worker (PAYG Social Feature)
	worker.InitUsageMilestoneWorker()
	log.Println("Usage milestone worker started")

	// --- E2: Provider leaderboard materialised view — periodic background refresh ---
	// Interval is configurable via MV_LEADERBOARD_REFRESH_MINS (default: 15 minutes).
	// Uses CONCURRENTLY so reads are never blocked during refresh.
	if db.DB != nil {
		refreshMins := 15
		if v := os.Getenv("MV_LEADERBOARD_REFRESH_MINS"); v != "" {
			if n, err2 := strconv.Atoi(v); err2 == nil && n > 0 {
				refreshMins = n
			}
		}
		worker.GoSupervised("LeaderboardMVRefresh", 5*time.Second, func() {
			ticker := time.NewTicker(time.Duration(refreshMins) * time.Minute)
			defer ticker.Stop()
			for range ticker.C {
				if err2 := db.DB.Exec("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_provider_leaderboard").Error; err2 != nil {
					log.Printf("Warning: leaderboard MV refresh failed: %v", err2)
				}
			}
		})
		log.Printf("Provider leaderboard MV refresh goroutine started (interval: %dm)", refreshMins)
	}

	// 2. Initialize Event Watcher
	if err := solanaClient.InitWatcher(solanaClient.WatcherConfig{
		RPCEndpoints: rpcEndpoints,
		WSEndpoint:   wsEndpoint,
		TreasuryAddr: os.Getenv("SOLANA_TREASURY_ADDRESS"),
		DepositAddrs: []string{os.Getenv("SOLANA_DEPOSIT_VAULT_ADDRESS")},
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
	r.RedirectTrailingSlash = false
	r.RemoveExtraSlash = false

	// Only trust X-Forwarded-For / X-Real-IP from loopback (host Caddy) by default.
	// Override with TRUSTED_PROXIES (comma-separated) or TRUSTED_PROXIES=none.
	if err := middleware.ConfigureTrustedProxies(r); err != nil {
		log.Fatalf("Failed to configure trusted proxies: %v", err)
	}

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

		if allowOrigin == "" && middleware.ChromeExtensionOriginAllowed(origin) {
			allowOrigin = origin
		}

		// 2. Fallback: Allow localhost-only origins in development mode.
		// Uses APP_ENV (aligned with docker-compose.yml). Never reflects arbitrary origins —
		// only http://localhost:* and http://127.0.0.1:* patterns are permitted.
		if allowOrigin == "" {
			appEnv := os.Getenv("APP_ENV")
			isDevEnv := appEnv == "development" || appEnv == "dev" || appEnv == "local"
			isLocalOrigin := strings.HasPrefix(origin, "http://localhost:") || strings.HasPrefix(origin, "http://127.0.0.1:")
			if isDevEnv && isLocalOrigin {
				allowOrigin = origin
			}
		}

		if allowOrigin != "" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", allowOrigin)
		} else {
			// Even if blocked, set a debug header for the user
			c.Writer.Header().Set("X-ProxyHub-CORS", "Blocked-Origin-"+origin)
		}

		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, UPDATE, PATCH")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With, X-Session-ID, X-API-Key")
		c.Writer.Header().Set("Access-Control-Expose-Headers", "Content-Length, X-Trace-ID, X-ProxyHub-CORS")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	// Health / readiness BEFORE security middleware (Docker + load balancer probes)
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})
	r.GET("/ready", func(c *gin.Context) {
		h := health.CheckSystem()
		if !h.Healthy {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"status":   "not_ready",
				"database": h.Database.Healthy,
				"redis":    h.Redis.Healthy,
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"status":   "ready",
			"database": true,
			"redis":    true,
		})
	})

	// OpenAPI contract location (public; redirects to the docs-hosted spec)
	api.RegisterOpenAPISpecRoutes(r)

	// Emergency Circuit Breaker (Industrial Security)
	r.Use(middleware.EmergencyBreaker(cm))

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

	adminAPIEnabled := strings.EqualFold(strings.TrimSpace(os.Getenv("ADMIN_API_ENABLED")), "true")
	if !adminAPIEnabled {
		// Centralized admin API surface is disabled unless ADMIN_API_ENABLED=true.
		r.Use(func(c *gin.Context) {
			if c.Request.URL.Path == "/v1/admin" || strings.HasPrefix(c.Request.URL.Path, "/v1/admin/") {
				c.AbortWithStatusJSON(http.StatusGone, gin.H{
					"error":   "admin_api_disabled",
					"message": "Set ADMIN_API_ENABLED=true to enable admin routes in this deployment",
				})
				return
			}
			c.Next()
		})
	}

	// Metrics and Monitoring Endpoints
	monitoring.RegisterMetricsRoutes(r)
	api.RegisterInternalAlertWebhook(r)

	// Circuit Breaker Stats Endpoint
	r.GET("/metrics/circuit-breakers", middleware.RequireMetricsAccess(), middleware.CircuitBreakerStatsHandler())

	// v1: Optional Auth (Publicly accessible, but identifies user if token present)
	v1 := r.Group("/v1")
	v1.Use(middleware.SupabaseAuthMiddlewareOptional(cfg))
	{
		api.RegisterHealthRoutes(v1)
		api.RegisterMonitoringRoutes(v1)
		api.RegisterAuthRoutes(v1)
		api.RegisterExtensionPublicRoutes(v1)
		api.RegisterMarketplaceGeoRoutes(v1) // Before /listings/:id (map pins)
		api.RegisterMapTopologyRoutes(v1)
		api.RegisterListingRoutes(v1)       // Mix of public/private
		api.RegisterCatalogRoutes(v1)       // Phase 3A: catalog products / offers
		api.RegisterListingSocialRoutes(v1) // Social integration for listings
		api.RegisterMilestoneRoutes(v1)     // Usage milestones
		api.RegisterUsageReviewRoutes(v1)   // Usage-based reviews
		api.RegisterCirclePoolRoutes(v1)    // Circle bandwidth pooling
		api.RegisterFeedRoutes(v1)          // Mix of public/private (Discover)
		api.RegisterProfileRoutes(v1)       // Public profiles
		api.RegisterPublicReviewRoutes(v1)
		api.RegisterSystemRoutes(v1)
		api.RegisterKYCRoutes(v1)
		api.RegisterReputationRoutes(v1)               // Phase 9.2 Trust Layer
		api.RegisterExplorerRoutes(v1)                 // System Explorer (Public blockchain explorer)
		api.RegisterExplorerWSRoutes(v1)               // Explorer WebSocket for real-time updates
		api.RegisterSDKRoutes(v1)                      // P1-A5: SDK Examples API
		api.RegisterGatewayRoutes(v1, cfg)             // Gateway node registration and heartbeat
		api.RegisterTreasuryPublicRoutes(v1)           // Phase 4.3: public treasury transparency
		api.RegisterGovernancePublicRoutes(v1)         // Public governance execution readiness
		api.RegisterGovernanceImpactRoutes(v1)         // Public proposal impact previews
		api.RegisterGovernanceTreasuryPublicRoutes(v1) // Treasury audit rows per proposal
		api.RegisterBetaProgramPublicRoutes(v1)        // Public beta task catalog (+ progress when token present)
		api.RegisterForumPublicRoutes(v1)              // Public forum browse/search/read endpoints
		api.RegisterBadgePublicRoutes(v1)              // Public badge catalog
		api.RegisterAgentPublicRoutes(v1)              // Public agent marketplace browse
		api.RegisterMarketplaceFunnelRoutes(v1)        // WS-D: client funnel events (optional auth)
		solanaClient.RegisterPublicRoutes(v1)          // Oracle/RPC health (no auth)
		api.RegisterNetworkRoutes(v1)                  // Public network aggregate (dashboard + landing)
		api.RegisterPassPublicRoutes(v1)               // Access Pass catalog (NFT entitlements)
		api.RegisterGatewayOperatorPublicRoutes(v1)    // Wave 5.B: gateway operator discovery
		api.RegisterP2PSignalingRoutes(v1)           // Track 3.2: P2P WebRTC/QUIC signaling
	}

	// Public Routes (No Authentication Required)
	api.RegisterProviderAuthRoute(v1) // CLI auth endpoint must be public

	// Bulk Proxy + B2B purchase API: JWT session or X-API-Key (phub_ / pk_)
	bulkAuth := v1.Group("/")
	bulkAuth.Use(middleware.RequireAuthOrAPIKey())
	bulkAuth.Use(middleware.RestrictExtensionDevice())
	{
		api.RegisterBulkRoutes(bulkAuth)
		api.RegisterPartnerPurchaseRoutes(bulkAuth)
	}

	// Protected Routes (Require Authentication)
	protected := v1.Group("/")
	protected.Use(middleware.RequireAuth())
	protected.Use(middleware.RestrictExtensionDevice())
	{
		providerOps := protected.Group("/")
		providerOps.Use(middleware.RequireProviderRole())
		{
			api.RegisterProviderNodeRoutes(providerOps)
			api.RegisterProviderTokenRoutes(providerOps)
			api.RegisterProviderLeaseRoutes(providerOps)
			api.RegisterProviderEarningsRoutes(providerOps)
			api.RegisterProviderClaimRoutes(providerOps)
			api.RegisterProviderServicesRoutes(providerOps)
			api.RegisterProviderRelationshipRoutes(providerOps)
		}

		api.RegisterBuyerRelationshipRoutes(protected)
		api.RegisterDisputeRoutes(protected)
		api.RegisterListingAppealRoutes(protected)
		api.RegisterCLIDistributionRoutes(v1) // Public CLI downloads
		api.RegisterGatewayTokenRoute(v1)     // Public: exchange provider token → gateway JWT
		api.RegisterSessionRoutes(protected)
		api.RegisterWalletRoutes(protected)
		api.RegisterOrderRoutes(protected)
		api.RegisterEscrowRoutes(protected)
		api.RegisterUsageRoutes(protected)
		api.RegisterExtensionProtectedRoutes(protected)
		api.RegisterStakingRoutes(protected)

		api.RegisterSmartMatchingRoutes(protected)
		api.RegisterGovernanceRoutes(protected)
		api.RegisterBetaProgramRoutes(protected)
		api.RegisterOnboardingRoutes(protected)
		api.RegisterCircleRoutes(protected)

		api.RegisterReferralRoutes(protected)
		api.RegisterSubscriptionRoutes(protected)
		api.RegisterPassRoutes(protected)
		api.RegisterLinkedWalletRoutes(protected)
		api.RegisterForumProtectedRoutes(protected)
		api.RegisterBadgeRoutes(protected)
		api.RegisterMessagingRoutes(protected)
		api.RegisterFriendRoutes(protected)
		api.RegisterNotificationRoutes(protected)
		api.RegisterShowcaseRoutes(protected)
		api.RegisterWebSocketRoutes(protected) // WebSocket for real-time updates

		api.RegisterProtectedReviewRoutes(protected)
		api.RegisterAgentProtectedRoutes(protected)
		api.RegisterAgentRegistryRoutes(protected)
		// Analytics & Geo
		api.RegisterAnalyticsRoutes(protected)
		api.RegisterGeoRoutes(protected)

		// Proxy Engine Services (Phase 16)
		api.RegisterServiceDiscoveryRoutes(protected)

		// Trustless Proofs (Phase 17)
		api.RegisterTrustlessRoutes(protected)

		// Decentralized Disputes (Phase 19)
		api.RegisterDisputeJuryRoutes(protected)

		// User Security (Phase 21)
		api.RegisterSecurityRoutes(protected)
		api.RegisterAPIKeyRoutes(protected)

		// Audit & Monitoring (Phase 22)
		api.RegisterAuditRoutes(protected)

		// GDPR (data export, account deletion scheduling)
		api.RegisterGDPRRoutes(protected)

		// Crypto ops (admin-only batch settle, treasury, telemetry)
		api.RegisterCryptoRoutes(protected)
		api.RegisterTreasuryMultisigRoutes(protected) // Phase 4.2: large treasury withdrawals

		// State Channels (Phase 5)
		api.RegisterChannelRoutes(protected)

		// Blockchain / Solana
		solanaClient.RegisterRoutes(protected)

		// Phase 4: Real-time session stream (SSE)
		api.RegisterSessionStreamRoutes(protected)

		// Provider Verification Tiers (Phase 6)
		api.RegisterTierRoutes(protected)

		// Marketplace listing moderation (dashboard moderators)
		api.RegisterPlatformListingModerationRoutes(protected)
	}

	if adminAPIEnabled {
		api.InitAdminConfig(&cfg.Admin)
		admin := v1.Group("/admin")
		api.RegisterAdminAuthRoutes(admin)
		adminProtected := admin.Group("/")
		adminProtected.Use(middleware.AdminAuthMiddleware(cfg))
		api.RegisterAdminRoutes(adminProtected)
		api.RegisterAdminDisputeRoutes(adminProtected)
		api.RegisterAdminOnboardingRoutes(adminProtected)
		api.RegisterAdminListingModerationRoutes(adminProtected)
		api.RegisterModerationAppealRoutes(adminProtected.Group("/listings"))
		api.RegisterAdminForumModerationRoutes(adminProtected)
		api.RegisterAdminPayoutRoutes(adminProtected)
		api.RegisterAdminNodeHealthRoutes(adminProtected)
		api.RegisterAdminMeRoute(adminProtected)
		log.Println("Admin API enabled (ADMIN_API_ENABLED=true)")
	} else {
		log.Println("Admin API disabled (set ADMIN_API_ENABLED=true to enable /v1/admin)")
	}

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

		rpcEndpoint := rpcEndpoints[0]

		pollInterval := 15 * time.Second
		if interval := os.Getenv("EXPLORER_INDEXER_POLL_INTERVAL_MS"); interval != "" {
			if ms, err := strconv.Atoi(interval); err == nil {
				pollInterval = time.Duration(ms) * time.Millisecond
			}
		}

		writerID := os.Getenv("EXPLORER_INDEXER_WRITER_ID")
		if writerID == "" {
			if host, err := os.Hostname(); err == nil && host != "" {
				writerID = host
			} else {
				writerID = "indexer-default"
			}
		}

		blockchainIndexer, err := indexer.NewBlockchainIndexer(indexer.IndexerConfig{
			RPCEndpoint:      rpcEndpoint,
			ProgramID:        programID,
			WriterID:         writerID,
			WriterPublicKey:  os.Getenv("EXPLORER_INDEXER_SIGNING_PUBLIC_KEY"),
			WriterPrivateKey: os.Getenv("EXPLORER_INDEXER_SIGNING_PRIVATE_KEY"),
			PollInterval:     pollInterval,
			BatchSize:        100,
			IndexAll:         os.Getenv("INDEXER_INDEX_ALL") == "true",
		})
		if err != nil {
			log.Printf("Warning: Failed to init Blockchain Indexer: %v", err)
		} else {
			blockchainIndexer.SetCallbacks(indexer.IndexerCallbacks{
				OnNewBlock:       api.NotifyNewBlock,
				OnNewTransaction: api.NotifyNewTransaction,
			})
			blockchainIndexer.Start()
			log.Println("Blockchain Explorer Indexer started")

			// P3-07: Validate on-chain IDL discriminators match compiled values.
			go func() {
				if err := solanaClient.LoadAndValidateIDL(context.Background(), rpcEndpoint, programID); err != nil {
					log.Printf("Warning: IDL validation error: %v", err)
				}
			}()

			// Register contracts
			registry := indexer.NewContractRegistry()
			treasuryAddr := os.Getenv("SOLANA_TREASURY_ADDRESS")
			if err := registry.RegisterProxyHubbContracts(programID, treasuryAddr); err != nil {
				log.Printf("Warning: Failed to register contracts: %v", err)
			}
		}

		// Start Node Sync Service
		nodeSyncInterval := 1 * time.Minute
		if interval := os.Getenv("NODE_SYNC_INTERVAL_MINUTES"); interval != "" {
			if mins, err := strconv.Atoi(interval); err == nil {
				nodeSyncInterval = time.Duration(mins) * time.Minute
			}
		}

		nodeSync := indexer.NewNodeSync(indexer.NodeSyncConfig{
			Interval: nodeSyncInterval,
		})
		nodeSync.SetCallbacks(indexer.NodeSyncCallbacks{
			OnNodeUpdate: api.NotifyNodeUpdate,
		})
		nodeSync.Start()
		log.Println("Node Sync Service started")
	}

	if os.Getenv("EXPLORER_METRICS_ENABLED") != "false" {
		indexer.StartExplorerMetricsAggregator(indexer.ExplorerMetricsIntervalFromEnv())
		log.Println("Explorer metrics aggregator started")
	} else {
		log.Println("Explorer metrics aggregator disabled (EXPLORER_METRICS_ENABLED=false)")
	}

	// Start Governance Proposal Worker
	governance.ScheduleProposalWorker(context.Background())

	// Initialize Marketplace Core (Phase 9 Hexagonal Architecture)
	marketRepo := db.NewMarketplaceRepository()
	marketService := services.NewMarketplaceService(marketRepo)
	api.InitMarketplaceService(marketService)
	log.Println("Marketplace Core Service initialized")

	// Start Liquidity Manager (Phase 5.2)
	oracleConfig := solanaClient.Config{
		RPCEndpoints:           rpcEndpoints,
		OracleKeypairPath:      os.Getenv("SOLANA_ORACLE_KEYPAIR"),
		TreasuryHotKeypairPath: func() string {
			if v := strings.TrimSpace(os.Getenv("SOLANA_TREASURY_HOT_KEYPAIR")); v != "" {
				return v
			}
			return strings.TrimSpace(os.Getenv("SOLANA_TREASURY_KEYPAIR"))
		}(),
		Network:                solanaClient.EffectiveSolanaNetwork(),
	}
	if oracleConfig.OracleKeypairPath == "" {
		oracleConfig.OracleKeypairPath = "oracle-keypair.json"
	}

	// Try to load oracle client, but don't crash if keypair missing (dev mode)
	if oracleClient, err := solanaClient.NewOracleClient(oracleConfig); err == nil {
		if err := solanaClient.ValidateConfiguredTreasuryAddresses(oracleClient); err != nil {
			log.Fatalf("Treasury custody misconfiguration: %v", err)
		}
		if oracleClient.HasSeparateTreasuryHot() {
			log.Printf("BC-08 custody split active: oracle=%s payout=%s",
				oracleClient.GetOraclePublicKey().String(),
				oracleClient.GetPayoutPublicKey().String())
		} else {
			log.Println("WARNING: BC-08 — treasury hot keypair not separated from oracle (legacy custody)")
		}
		// --- P0.3: Attach VelocityGuard to the oracle client ---
		// Reads ORACLE_MAX_SINGLE_TRANSFER_SOL and ORACLE_MAX_HOURLY_OUTFLOW_SOL from env.
		// Set ORACLE_TRANSFER_FREEZE=true to freeze all transfers immediately.
		vg := solanaClient.NewVelocityGuard(redisClient.Client, func(title, msg string) {
			alerts.Send(alerts.Critical, title, msg)
		})
		if os.Getenv("ORACLE_TRANSFER_FREEZE") == "true" {
			vg.Freeze()
			log.Println("[SECURITY] ORACLE_TRANSFER_FREEZE=true — all oracle transfers are frozen at startup")
		}
		oracleClient.SetVelocityGuard(vg)
		solanaClient.RegisterOracleClient(oracleClient)
		treasury.GetManager().RefreshOracle()
		log.Println("Oracle velocity guard attached")

		// BC-06: multi-sig settle client (oracle KMS + local cosigner)
		if err := solanaClient.InitMultiSigOracle(oracleClient); err != nil {
			log.Printf("Warning: Failed to init Multi-Sig oracle: %v", err)
		} else if ms := solanaClient.GetMultiSigOracle(); ms != nil {
			var loadErr error
			for attempt := 1; attempt <= 4; attempt++ {
				ctxMS, cancelMS := context.WithTimeout(context.Background(), 15*time.Second)
				loadErr = ms.LoadMultiSigConfig(ctxMS)
				cancelMS()
				if loadErr == nil {
					break
				}
				log.Printf("Warning: multi-sig config load attempt %d/4: %v", attempt, loadErr)
				time.Sleep(time.Duration(attempt) * 2 * time.Second)
			}
			if loadErr != nil {
				log.Printf("Warning: Failed to load multi-sig config after retries: %v (will reload on settle)", loadErr)
			} else {
				log.Printf("Multi-Sig Oracle initialized - Threshold: %d, Signers: %d, authorized_local=%v, cosigner_env=%v",
					ms.GetThreshold(), len(ms.GetSigners()), ms.IsAuthorizedSigner(),
					strings.TrimSpace(os.Getenv("PROXYHUB_MULTISIG_COSIGNER_KEYPAIR")) != "")
			}
		}

		solanaClient.InitStakingService(oracleClient)
		solanaClient.InitProofService(oracleClient)

		// Wire live SOL transfer into the billing package for provider payouts
		// Enhanced with treasury monitoring and multi-sig support
		singleTransferFunc := func(ctx context.Context, recipient string, amountSOL float64) error {
			// Get treasury manager for monitoring
			tm := treasury.GetManager()

			// Record outgoing transfer for velocity monitoring
			if err := tm.RecordOutgoingTransfer(ctx, amountSOL); err != nil {
				logging.Warn().Err(err).Msg("Failed to record outflow, continuing with transfer")
			}

			recipientKey, err := solanaGo.PublicKeyFromBase58(recipient)
			if err != nil {
				return err
			}
			lamports := solanaClient.SOLToLamports(amountSOL)

			// Check if multi-sig oracle is available and should be used
			// For large transfers (> 1 SOL), require multi-sig if available
			if amountSOL >= 1.0 {
				if ms := solanaClient.GetMultiSigOracle(); ms != nil && ms.IsAuthorizedSigner() {
					logging.Info().
						Float64("amount_sol", amountSOL).
						Str("recipient", recipient).
						Msg("Using multi-sig for large payout")

					// For multi-sig, we need to collect signatures from other oracles
					// This is a simplified version - in production, this would coordinate
					// with other oracle instances to collect threshold signatures
					_, err := oracleClient.SendSOL(ctx, recipientKey, lamports)
					return err
				}
			}

			// Standard single-sig transfer for smaller amounts
			_, err = oracleClient.SendSOL(ctx, recipientKey, lamports)
			return err
		}

		// Batch transfer function for processing multiple payouts
		batchTransferFunc := func(ctx context.Context, items []models.BatchPayoutItem) (string, error) {
			transfers := make([]solanaClient.TransferRequest, len(items))
			for i, item := range items {
				recipientKey, err := solanaGo.PublicKeyFromBase58(item.WalletAddress)
				if err != nil {
					return "", fmt.Errorf("invalid recipient address %s: %w", item.WalletAddress, err)
				}
				transfers[i] = solanaClient.TransferRequest{
					Recipient: recipientKey,
					Lamports:  solanaClient.SOLToLamports(item.AmountSOL),
				}
			}
			return oracleClient.BatchTransferSOL(ctx, transfers)
		}

		billing.SetSOLTransferFunc(singleTransferFunc)
		billing.InitBatchProcessor(singleTransferFunc, batchTransferFunc)
		billing.StartSettlementWorker()
		billing.StartPayoutRetryWorker()
		log.Println("Payout retry worker started")
		api.StartCompensationOutboxWorker()
		log.Println("Compensation outbox worker started")
		api.StartEscrowAutoReleaseWorker()
		log.Println("Escrow auto-release worker started (challenge window gated)")
		api.StartDisputeExpiryWorker()
		log.Println("Dispute expiry worker started")

		// Wire the batch processor into the earnings API so recordProviderEarning can queue payouts
		api.SetBatchPayoutProcessor(billing.GetBatchProcessor())

		// Initialize Price Feed Service (Phase 2: Operational Reliability)
		pricing.InitPriceFeed()
		worker.GoSupervised("PriceFeedUpdater", 5*time.Second, func() {
			pricing.GetPriceFeed().StartPriceUpdater(context.Background(), 5*time.Minute)
		})
		log.Println("Price feed service started with 5-minute update interval")

		// Initialize Ledger Reconciliation Service (Phase 2: Operational Reliability)
		reconService := treasury.NewReconciliationService()
		reconService.StartReconciliationWorker(context.Background())
		log.Println("Ledger reconciliation service started (daily at 00:00 UTC)")

		// Initialize Anomaly Detector Service (disable locally with ANOMALY_DETECTOR_ENABLED=false)
		if os.Getenv("ANOMALY_DETECTOR_ENABLED") != "false" {
			detector := worker.NewAnomalyDetector(5 * time.Minute)
			worker.GoSupervised("AnomalyDetector", 5*time.Second, func() {
				detector.Start(context.Background())
			})
			log.Println("Anomaly detector service started (interval: 5 minutes)")
		} else {
			log.Println("Anomaly detector disabled (ANOMALY_DETECTOR_ENABLED=false)")
		}

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
		worker.GoSupervised("SettlementAggregator", 5*time.Second, func() {
			sa.Start(context.Background())
		})

		log.Println("Liquidity Manager, Ghost Prober, Staking, Proof and Settlement services started")
	} else {
		appEnv := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
		if appEnv == "production" || appEnv == "prod" || appEnv == "staging" || appEnv == "testnet" {
			log.Fatalf("FATAL: oracle/treasury custody init failed in %s: %v", appEnv, err)
		}
		log.Printf("Skipping Liquidity Manager: %v", err)
	}

	// Start ZK-Settlement Worker (Phase 8 Asynchronous Confidential Settlement)
	zkWorker := worker.NewZKSettlementWorker()
	zkWorker.Start(context.Background())
	log.Println("ZK-Settlement Worker started")

	// Start receipt-to-manifest coordinator worker for durable metering ingestion.
	settlementCoordinator := worker.NewSettlementCoordinatorWorker()
	if err := settlementCoordinator.Start(context.Background()); err != nil {
		log.Printf("Failed to start Settlement Coordinator Worker: %v", err)
	} else {
		log.Println("Settlement Coordinator Worker started")
	}

	// EV-05 lite: drain metering_wal_spill → usage_receipts when Redis WAL writes fail.
	worker.StartMeteringSpillDrainWorker(context.Background())
	log.Println("Metering Spill Drain Worker started")

	// Start Marketplace Watcher (Phase 9.1 Real-time Telemetry)
	mw := worker.NewMarketplaceWatcher()
	if err := mw.Start(context.Background()); err != nil {
		log.Printf("Failed to start Marketplace Watcher: %v", err)
	}

	// Start Treasury Event Consumer (EV-01: durable consumer on TREASURY stream)
	treasuryConsumer := worker.NewTreasuryEventConsumer()
	if err := treasuryConsumer.Start(context.Background()); err != nil {
		log.Printf("Failed to start Treasury Event Consumer: %v", err)
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
	worker.GoSupervised("RegistrySyncWorker", 5*time.Second, func() {
		rw.Start(context.Background())
	})
	log.Println("Registry Sync Worker started")

	// Start AI Agent Worker (Phase 13 Orchestration)
	aw := worker.NewAgentWorker()
	worker.GoSupervised("AgentWorker", 5*time.Second, func() {
		aw.Start(context.Background())
	})
	log.Println("AI Agent Execution Worker started")

	// Start All Background Workers (Phase 17 Reliability)
	worker.StartAll(nil) // nil queue as placeholder or use internal queue

	// Start Provider Tier Evaluator (Phase 6)
	worker.StartTierEvaluator()
	log.Println("Provider Tier Evaluator started")

	// Start Heartbeat Monitor — marks nodes offline after 5m without a heartbeat
	worker.OnNodeOffline = api.NotifyNodeUpdate
	worker.OnLinkTopologyAggregated = api.NotifyLinkTopologyUpdate
	worker.StartHeartbeatMonitor()
	log.Println("Heartbeat Monitor started")

	// Start settlement telemetry alert monitor (Phase 0 hardening).
	worker.GoSupervised("SettlementTelemetryAlerts", 5*time.Second, func() {
		monitoring.StartSettlementTelemetryAlerts(context.Background())
	})
	log.Println("Settlement telemetry alert monitor started")

	// Start GeoIP backfill — resolves lat/lon for explorer nodes that have an IP
	// but no coordinates yet (runs as a low-rate background worker)
	worker.StartGeoIPWorker()
	log.Println("GeoIP backfill worker started")

	worker.StartMapTopologyWorker()
	log.Println("Map topology aggregator started")

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: r,
	}

	// Shutdown on SIGINT/SIGTERM so in-flight requests (withdrawals, escrow
	// settlement, usage ingestion) can drain before the process exits.
	shutdownCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverErr := make(chan error, 1)
	go func() {
		serverErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serverErr:
		if err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	case <-shutdownCtx.Done():
		log.Println("Shutdown signal received, draining HTTP server...")
		drainCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := srv.Shutdown(drainCtx); err != nil {
			log.Printf("Graceful shutdown failed, forcing close: %v", err)
			_ = srv.Close()
		}
		log.Println("HTTP server drained")
	}
}
