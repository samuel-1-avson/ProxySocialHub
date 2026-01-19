package testutil

import (
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisInternal "github.com/proxyhubb/control-api/internal/redis"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var (
	testDBOnce sync.Once
	testDB     *gorm.DB
	mr         *miniredis.Miniredis
)

// SetupTestRedis initializes a miniredis instance for testing.
func SetupTestRedis(t *testing.T) {
	t.Helper()
	// Ensure previous instance is closed if any (though usually one per test or shared)
	// Ideally we run one per test or clear it.
	// For simplicity, create new one.

	m, err := miniredis.Run()
	if err != nil {
		t.Fatalf("Failed to start miniredis: %v", err)
	}
	t.Cleanup(func() {
		m.Close()
	})

	redisInternal.Client = redis.NewClient(&redis.Options{
		Addr: m.Addr(),
	})
}

// SetupTestDB initializes a PostgreSQL test database connection.
// Uses TEST_DATABASE_URL environment variable or defaults to a local test database.
// The database is shared across tests but each test should clean up its own data.
func SetupTestDB(t *testing.T) {
	t.Helper()

	testDBOnce.Do(func() {
		dsn := os.Getenv("TEST_DATABASE_URL")
		if dsn == "" {
			// Default to local test database (aligned with docker-compose)
			dsn = "host=localhost user=proxyhubb password=proxyhubb dbname=proxyhubb_test port=5432 sslmode=disable"
		}

		var err error
		testDB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Error), // Log errors during tests
		})
		if err != nil {
			// If we can't connect, skip the test rather than fail
			// This allows tests to be skipped when no DB is available
			t.Skipf("Skipping test: Could not connect to test database: %v", err)
			return
		}

		// Enable uuid-ossp extension
		if err := testDB.Exec("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"").Error; err != nil {
			t.Skipf("Skipping test: Failed to enable uuid-ossp extension: %v", err)
			return
		}

		// Run migrations
		err = testDB.AutoMigrate(
			&models.User{},
			&models.Wallet{},
			&models.WalletLedgerEntry{},
			&models.Session{},
			&models.Node{},
			&models.KycVerification{},
			&models.TOTPBackupCode{},
			&models.APIKey{},
			&models.AuditLog{},
			&models.PendingTransaction{},
			&models.ForumCategory{},
			&models.ForumThread{},
			&models.ForumPost{},
			&models.ForumVote{},
			&models.Review{},
			&models.Conversation{},
			&models.Message{},
			&models.FriendRequest{},
			&models.Friendship{},
			&models.ProxyListing{},
			&models.Order{},
			&models.FeedEvent{},
			&models.ProviderNode{},
			&models.UptimeCheck{},
			&models.UseCase{},
			&models.UserPreference{},
		)
		if err != nil {
			t.Skipf("Skipping test: Failed to run migrations: %v", err)
			return
		}
	})

	if testDB == nil {
		t.Skip("Skipping test: Test database not available")
		return
	}

	// Set the global DB for the api package to use
	db.DB = testDB
}

// CleanupTestData cleans up test data after a test.
// Call this in a defer at the start of each test.
func CleanupTestData(t *testing.T, tables ...string) {
	t.Helper()
	t.Cleanup(func() {
		if db.DB == nil {
			return
		}
		// Disable FK checks to allow deleting in any order
		db.DB.Exec("SET session_replication_role = 'replica';")
		for _, table := range tables {
			db.DB.Exec(fmt.Sprintf("DELETE FROM %s WHERE 1=1", table))
		}
		db.DB.Exec("SET session_replication_role = 'origin';")
	})
}

// CreateTestUser creates a user for testing and returns it.
// The user has email verification enabled and password "password123".
func CreateTestUser(t *testing.T, email, role string) *models.User {
	t.Helper()

	user := &models.User{
		Email:     email,
		Role:      role,
		Status:    models.UserStatusActive,
		TrustTier: models.TrustTierNew,
		KYCStatus: models.KYCStatusNotStarted,
	}

	if err := db.DB.Create(user).Error; err != nil {
		t.Fatalf("Failed to create test user: %v", err)
	}

	// Create associated wallet
	wallet := &models.Wallet{
		UserID:  user.ID,
		Balance: 100.0, // Start with some balance for testing
	}
	db.DB.Create(wallet)

	return user
}

// UniqueEmail generates a unique email for testing to avoid conflicts.
func UniqueEmail(prefix string) string {
	return fmt.Sprintf("%s_%d@test.com", prefix, time.Now().UnixNano())
}
