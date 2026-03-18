package db

import (
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

var DB *gorm.DB

// CurrentSchemaVersion is used to prevent redundant migrations on every startup.
// Increment this whenever any model in /internal/models is updated.
const CurrentSchemaVersion = "20260316-0004"

// modelsToMigrate is the single, deduplicated list of all GORM models.
// Order matters: parent tables must precede child tables that reference them via FK.
// I7 fix: AuditLog was previously registered twice — now registered exactly once.
var modelsToMigrate = []interface{}{
	// Explorer / Blockchain cache (no FKs into app tables)
	&models.ExplorerBlock{},
	&models.ExplorerTransaction{},
	&models.ExplorerNode{},
	&models.ExplorerContract{},
	&models.ExplorerMetrics{},
	// Core Identity
	&models.User{},
	&models.Wallet{},
	&models.WalletLedgerEntry{},
	&models.StakingPosition{},
	&models.TOTPBackupCode{},
	&models.APIKey{},
	&models.RefreshTokenFamily{},
	// Audit — single registration (I7: removed duplicate that was under "Advanced Security")
	&models.AuditLog{},
	// Nodes & Sessions
	&models.Node{},
	&models.Session{},
	// Marketplace & Orders
	&models.ProxyListing{},
	&models.SavedListing{},
	&models.Order{},
	&models.EscrowTransaction{},
	&models.EscrowDispute{},
	&models.Dispute{},
	// Social
	&models.Review{},
	&models.Follow{},
	&models.FeedEvent{},
	&models.FriendRequest{},
	&models.Friendship{},
	&models.Badge{},
	&models.UserBadge{},
	// Subscriptions
	&models.SubscriptionPlan{},
	&models.UserSubscription{},
	// Incentivization
	&models.ProofOfService{},
	&models.MinerWeight{},
	// Governance
	&models.Proposal{},
	&models.Vote{},
	// Messaging
	&models.Conversation{},
	&models.Message{},
	// Circles & Provider Clans
	&models.Circle{},
	&models.CircleMember{},
	&models.CircleInvite{},
	&models.CircleSLA{},
	&models.CircleDailyStats{},
	&models.CirclePost{},
	&models.CircleLease{},
	&models.ProviderNode{},
	&models.PendingTransaction{},
	// Smart Matching
	&models.UseCase{},
	&models.UserPreference{},
	&models.MatchRequest{},
	// Onboarding
	&models.ProviderApplication{},
	// Forum
	&models.ForumCategory{},
	&models.ForumThread{},
	&models.ForumPost{},
	&models.ForumVote{},
	// Social Features
	&models.Notification{},
	&models.NotificationPreference{},
	&models.ProviderShowcase{},
	&models.SpeedTest{},
	&models.Testimonial{},
	&models.ProviderStats{},
	&models.MessageReaction{},
	// Market Agents
	&models.MarketAgent{},
	&models.AgentInstance{},
	&models.AgentJob{},
	// Analytics
	&models.UsageRecord{},
	// AI Agents
	&models.Agent{},
	&models.AgentOutput{},
	// Blockchain Integration
	&models.LinkedWallet{},
	&models.BlockchainStateCache{},
	&models.EncryptedCredentials{},
	// Proxy Pool
	&models.ProxyPool{},
	// Proxy Engine Configuration
	&models.ServiceConfiguration{},
	&models.SessionConfiguration{},
	&models.SystemConfiguration{},
	&models.RoutingProfile{},
	// Trustless Proofs
	&models.UsageProof{},
	// Quality Attestation — ConsensusRound must precede QualityAttestation (FK)
	&models.Validator{},
	&models.ConsensusRound{},
	&models.QualityAttestation{},
	// Decentralised Disputes
	&models.DisputeJury{},
	// User Security
	&models.UserSettings{},
	&models.UserSession{},
	&models.LoginAttempt{},
	&models.AccountLockout{},
	// Advanced Security (AuditLog already registered above — I7 duplicate removed)
	&models.SecurityAnomaly{},
	&models.WebAuthnCredential{},
	// Session Quality
	&models.SessionMetrics{},
	// Admin
	&models.AdminNote{},
	// Billing Reliability
	&models.PayoutRetryQueue{},
	// Provider CLI & Token Auth
	&models.ProviderToken{},
	&models.ProviderNodeRegistration{},
	&models.CLIDownload{},
	// Spending Limits
	&models.SpendingRecord{},
	// Batch Payouts
	&models.BatchPayout{},
	&models.BatchPayoutItem{},
	&models.PendingPayout{},
	// Provider Earnings
	&models.ProviderEarning{},
	// Provider Reputation Score
	&models.ProviderScore{},
}

func Init(dsn string) error {
	if dsn == "" {
		log.Println("DATABASE_URL not set, skipping DB connection")
		return nil
	}

	// --- E8: Build GORM logger from environment ---
	// DB_LOG_LEVEL: silent | error | warn | info  (default: warn — logs slow queries + errors)
	// DB_SLOW_QUERY_MS: slow-query threshold in milliseconds (default: 500)
	logLevel := gormlogger.Warn
	switch os.Getenv("DB_LOG_LEVEL") {
	case "silent":
		logLevel = gormlogger.Silent
	case "error":
		logLevel = gormlogger.Error
	case "info":
		logLevel = gormlogger.Info
	}
	slowThreshold := 500 * time.Millisecond
	if v := os.Getenv("DB_SLOW_QUERY_MS"); v != "" {
		if ms, err2 := strconv.Atoi(v); err2 == nil && ms > 0 {
			slowThreshold = time.Duration(ms) * time.Millisecond
		}
	}
	gormLogger := gormlogger.New(
		log.New(os.Stdout, "\r\n[DB] ", log.LstdFlags),
		gormlogger.Config{
			SlowThreshold:             slowThreshold,
			LogLevel:                  logLevel,
			IgnoreRecordNotFoundError: true, // record-not-found is a normal code path, not an error
			Colorful:                  os.Getenv("GIN_MODE") != "release",
		},
	)

	var err error
	DB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: gormLogger,
	})
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	log.Println("Database connected successfully")

	// Get underlying sql.DB for connection pooling
	sqlDB, err := DB.DB()
	if err != nil {
		return fmt.Errorf("failed to get database instance: %w", err)
	}

	// Configure connection pool.
	// For Supabase / PgBouncer (transaction-pool mode) keep max conns low (≤10)
	// to avoid exhausting the pooler.  For a direct PostgreSQL instance, increase
	// via DB_MAX_OPEN_CONNS / DB_MAX_IDLE_CONNS environment variables.
	maxOpen := 10 // safe default for Supabase transaction-pool
	if v := os.Getenv("DB_MAX_OPEN_CONNS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxOpen = n
		}
	}
	maxIdle := 2
	if v := os.Getenv("DB_MAX_IDLE_CONNS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxIdle = n
		}
	}
	sqlDB.SetMaxOpenConns(maxOpen)
	sqlDB.SetMaxIdleConns(maxIdle)
	sqlDB.SetConnMaxLifetime(time.Hour)        // Maximum time a connection can be reused
	sqlDB.SetConnMaxIdleTime(10 * time.Minute) // Maximum time a connection can be idle

	// Enable uuid-ossp extension
	if err := DB.Exec("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"").Error; err != nil {
		log.Printf("Warning: Failed to enable uuid-ossp extension: %v", err)
	}

	// Register Prometheus query-duration metrics plugin (E8)
	RegisterMetricsPlugin(DB)

	// --- I1: AUTO_MIGRATE GUARD ---
	// AutoMigrate only runs when AUTO_MIGRATE=true is explicitly set.
	// In production, set this only in the dedicated migration init-container or job.
	// Normal API replicas leave AUTO_MIGRATE unset so that:
	//   1. Pod startup is fast (no DDL locking PgBouncer/Supabase connections)
	//   2. A failed migration cannot silently start an API pod with a broken schema
	if os.Getenv("AUTO_MIGRATE") != "true" {
		log.Println("AUTO_MIGRATE is not set — skipping schema migration " +
			"(set AUTO_MIGRATE=true in migration containers/jobs to apply schema changes)")
		return nil
	}

	// --- SMART MIGRATION GUARD ---
	// 1. Always migrate the metadata table first so we can read schema_version
	if err := DB.AutoMigrate(&models.SystemConfiguration{}); err != nil {
		log.Printf("Warning: Metadata migration failed: %v", err)
	}

	// 2. Check current version
	var current models.SystemConfiguration
	DB.Where("key = ?", "schema_version").First(&current)

	canSkip := current.Value == CurrentSchemaVersion
	if os.Getenv("FORCE_MIGRATE") == "true" {
		canSkip = false
	}

	if canSkip {
		log.Printf("Database schema is up to date (Version: %s), skipping AutoMigrate", CurrentSchemaVersion)
	} else {
		log.Printf("Updating database schema from '%s' to '%s'...", current.Value, CurrentSchemaVersion)

		// Auto-migrate schema (Full model list)
		err = DB.AutoMigrate(
			&models.ExplorerBlock{},
			&models.ExplorerTransaction{},
			&models.ExplorerNode{},
			&models.ExplorerContract{},
			&models.ExplorerMetrics{},
			&models.User{},
			&models.Wallet{},
			&models.WalletLedgerEntry{},
			&models.StakingPosition{},
			&models.Session{},
			&models.Node{},
			&models.TOTPBackupCode{},
			&models.APIKey{},
			&models.AuditLog{},
			&models.RefreshTokenFamily{},

			// Marketplace & Orders
			&models.ProxyListing{},
			&models.SavedListing{},
			&models.Order{},
			&models.EscrowTransaction{},
			&models.EscrowDispute{},
			&models.Dispute{},

			&models.Review{},
			&models.Follow{},
			&models.FeedEvent{},
			&models.FriendRequest{},
			&models.Friendship{},
			&models.Badge{},
			&models.UserBadge{},

			// Subscriptions
			&models.SubscriptionPlan{},
			&models.UserSubscription{},

			// Subtensor / Incentivization
			&models.ProofOfService{},
			&models.MinerWeight{},

			// Governance
			&models.Proposal{},
			&models.Vote{},

			// Messaging
			&models.Conversation{},
			&models.Message{},

			// Clans & Providers
			&models.Circle{},
			&models.CircleMember{},
			&models.CircleInvite{},
			&models.CircleSLA{},
			&models.CircleDailyStats{},
			&models.CirclePost{},
			&models.CircleLease{},
			&models.ProviderNode{},
			&models.PendingTransaction{},

			// Smart Matching
			&models.UseCase{},
			&models.UserPreference{},
			&models.MatchRequest{},

			// Onboarding
			&models.ProviderApplication{},

			// Forum
			&models.ForumCategory{},
			&models.ForumThread{},
			&models.ForumPost{},
			&models.ForumVote{},
			
			// Social Features (Notifications, Showcases)
			&models.Notification{},
			&models.NotificationPreference{},
			&models.ProviderShowcase{},
			&models.SpeedTest{},
			&models.Testimonial{},
			&models.ProviderStats{},
			&models.MessageReaction{},

			&models.MarketAgent{},
			&models.AgentInstance{},
			&models.AgentJob{},

			// Analytics
			&models.UsageRecord{},

			// Agents (Phase 12)
			&models.Agent{},
			&models.AgentOutput{},

			// Blockchain Integration (Phase 15+)
			&models.LinkedWallet{},
			&models.BlockchainStateCache{},
			&models.EncryptedCredentials{},

			// Bulk Proxy Pool API (Phase 5)
			&models.ProxyPool{},

			// Proxy Engine (Phase 16)
			&models.ServiceConfiguration{},
			&models.SessionConfiguration{},
			&models.SystemConfiguration{},
			&models.RoutingProfile{},

			// Trustless Proofs (Phase 17)
			&models.UsageProof{},

			// Quality Attestation (Phase 18)
			&models.Validator{},
			&models.ConsensusRound{},     // Must precede QualityAttestation (FK dependency)
			&models.QualityAttestation{},

			// Decentralized Disputes (Phase 19)
			&models.DisputeJury{},

			// User Security (Phase 21)
			&models.UserSettings{},
			&models.UserSession{},
			&models.LoginAttempt{},
			&models.AccountLockout{},

			// Advanced Security (Phase 22)
			&models.AuditLog{},
			&models.SecurityAnomaly{},
			&models.WebAuthnCredential{},

			// Session Quality (Phase 23)
			&models.SessionMetrics{},

			// Admin Panel (Phase Admin)
			&models.AdminNote{},

			// Billing reliability (Phase billing-retry)
			&models.PayoutRetryQueue{},

			// Provider CLI & Token Auth
			&models.ProviderToken{},
			&models.ProviderNodeRegistration{},
			&models.CLIDownload{},

			// Spending Limits
			&models.SpendingRecord{},

			// Batch Payouts
			&models.BatchPayout{},
			&models.BatchPayoutItem{},
			&models.PendingPayout{},

			// Provider Earnings
			&models.ProviderEarning{},

			// Provider Reputation Score
			&models.ProviderScore{},
		)

		if err != nil {
			log.Printf("Failed to migrate database: %v", err)
			// Don't fail entire startup, just warn
		} else {
			// Update version key (Explicit Save)
			versionEntry := models.SystemConfiguration{
				Key:       "schema_version",
				Value:     CurrentSchemaVersion,
				UpdatedAt: time.Now(),
			}

			// Use Upsert logic
			if err := DB.Where("key = ?", "schema_version").First(&current).Error; err == nil {
				current.Value = CurrentSchemaVersion
				current.UpdatedAt = time.Now()
				if err := DB.Save(&current).Error; err != nil {
					log.Printf("Error updating schema version: %v", err)
				} else {
					log.Printf("Successfully updated schema version to %s", CurrentSchemaVersion)
				}
			} else {
				if err := DB.Create(&versionEntry).Error; err != nil {
					log.Printf("Error creating schema version: %v", err)
				} else {
					log.Printf("Successfully created schema version %s", CurrentSchemaVersion)
				}
			}
		}
	}

	// Force removal of uuid_generate_v4 defaults if they exist, as they cause issues if extension is missing
	// We handle UUID generation in Go code now.
	tables := []string{
		"sessions", "wallets", "wallet_ledger_entries",
		"conversations", "messages",
		"orders", "proxy_listings",
		"feed_events", "pending_transactions",
		"escrow_transactions", "disputes",
	}
	for _, table := range tables {
		// Use manual SQL to drop default. GORM auto-migrate doesn't always remove them.
		// Ignore error if specific constraint/table doesn't exist
		_ = DB.Exec(fmt.Sprintf("ALTER TABLE %s ALTER COLUMN id DROP DEFAULT", table)).Error
	}

	return nil
}

// Close closes the database connection gracefully
func Close() {
	if DB != nil {
		sqlDB, err := DB.DB()
		if err == nil {
			sqlDB.Close()
			log.Println("Database connection closed")
		}
	}
}
