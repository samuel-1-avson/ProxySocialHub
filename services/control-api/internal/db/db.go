package db

import (
	"fmt"
	"log"
	"os"
	"time"

	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

// CurrentSchemaVersion is used to prevent redundant migrations on every startup.
// Increment this whenever any model in /internal/models is updated.
const CurrentSchemaVersion = "20260314-0001"

func Init(dsn string) error {
	if dsn == "" {
		log.Println("DATABASE_URL not set, skipping DB connection")
		return nil
	}

	var err error
	DB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	log.Println("Database connected successfully")

	// Get underlying sql.DB for connection pooling
	sqlDB, err := DB.DB()
	if err != nil {
		return fmt.Errorf("failed to get database instance: %w", err)
	}

	// Configure connection pool (Optimized for remote Supabase Transaction Pool)
	sqlDB.SetMaxOpenConns(10)                  // Reduced from 100 to prevent connection exhaustion
	sqlDB.SetMaxIdleConns(2)                   // Minimum idle connections
	sqlDB.SetConnMaxLifetime(time.Hour)        // Maximum time a connection can be reused
	sqlDB.SetConnMaxIdleTime(10 * time.Minute) // Maximum time a connection can be idle

	// Enable uuid-ossp extension
	if err := DB.Exec("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"").Error; err != nil {
		log.Printf("Warning: Failed to enable uuid-ossp extension: %v", err)
	}

	// --- SMART MIGRATION GUARD (Phase 24) ---
	// 1. Fast migrate metadata table
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
			&models.KycVerification{},
			&models.TOTPBackupCode{},
			&models.APIKey{},
			&models.AuditLog{},
			&models.RefreshTokenFamily{},

			// Marketplace & Orders
			&models.ProxyListing{},
			&models.SavedListing{},
			&models.Order{},
			&models.EscrowTransaction{},
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
			&models.QualityAttestation{},
			&models.ConsensusRound{},

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
