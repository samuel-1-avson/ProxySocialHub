package db

import (
	"fmt"
	"log"
	"time"

	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

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

	// Configure connection pool
	sqlDB.SetMaxOpenConns(100)                 // Maximum number of open connections
	sqlDB.SetMaxIdleConns(10)                  // Maximum number of idle connections
	sqlDB.SetConnMaxLifetime(time.Hour)        // Maximum time a connection can be reused
	sqlDB.SetConnMaxIdleTime(10 * time.Minute) // Maximum time a connection can be idle

	// Enable uuid-ossp extension
	if err := DB.Exec("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"").Error; err != nil {
		log.Printf("Warning: Failed to enable uuid-ossp extension: %v", err)
	}

	// Auto-migrate schema
	err = DB.AutoMigrate(
		&models.User{},
		// &models.OAuthIdentity{}, // Removed for Supabase
		&models.Wallet{},
		&models.WalletLedgerEntry{},
		&models.Session{},
		&models.Node{},
		&models.KycVerification{},
		&models.TOTPBackupCode{},
		&models.APIKey{},
		&models.AuditLog{},
		// Refresh token families (for rotation)
		// Refresh token families (for rotation)
		&models.RefreshTokenFamily{},

		// Marketplace & Orders
		&models.ProxyListing{},
		&models.SavedListing{},
		&models.Order{},

		// Social & Reviews
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

		// Messaging
		&models.Conversation{},
		&models.Message{},

		// Clans & Providers
		&models.Circle{},
		&models.CircleMember{},
		&models.CircleInvite{},
		&models.CircleSLA{},
		&models.CircleDailyStats{},
		&models.CircleLease{},
		&models.ProviderNode{},
	)
	if err != nil {
		log.Printf("Failed to migrate database: %v", err)
		// Don't fail entire startup, just warn
	} else {
		log.Println("Database migrations applied")
	}

	// Force removal of uuid_generate_v4 defaults if they exist, as they cause issues if extension is missing
	// We handle UUID generation in Go code now.
	tables := []string{
		"sessions", "wallets", "wallet_ledger_entries",
		"conversations", "messages",
		"orders", "proxy_listings",
		"feed_events", "pending_transactions",
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
