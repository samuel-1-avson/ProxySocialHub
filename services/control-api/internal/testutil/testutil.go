package testutil

import (
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var (
	testDBOnce sync.Once
	testDB     *gorm.DB
)

// SetupTestDB initializes a PostgreSQL test database connection.
// Uses TEST_DATABASE_URL environment variable or defaults to a local test database.
// The database is shared across tests but each test should clean up its own data.
func SetupTestDB(t *testing.T) {
	t.Helper()

	testDBOnce.Do(func() {
		dsn := os.Getenv("TEST_DATABASE_URL")
		if dsn == "" {
			// Default to local test database
			dsn = "host=localhost user=postgres password=postgres dbname=proxyhubb_test port=5432 sslmode=disable"
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
		for _, table := range tables {
			db.DB.Exec(fmt.Sprintf("DELETE FROM %s WHERE 1=1", table))
		}
	})
}

// CreateTestUser creates a user for testing and returns it.
// The user has email verification enabled and password "password123".
func CreateTestUser(t *testing.T, email, role string) *models.User {
	t.Helper()

	user := &models.User{
		Email:         email,
		PasswordHash:  HashPassword("password123"),
		Role:          role,
		Status:        models.UserStatusActive,
		EmailVerified: true,
		TrustTier:     models.TrustTierNew,
		KYCStatus:     models.KYCStatusNotStarted,
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

// CreateUnverifiedTestUser creates an unverified user for testing.
func CreateUnverifiedTestUser(t *testing.T, email, role string) *models.User {
	t.Helper()

	token := "test-verification-token-" + email
	expires := time.Now().Add(24 * time.Hour)

	user := &models.User{
		Email:                    email,
		PasswordHash:             HashPassword("password123"),
		Role:                     role,
		Status:                   models.UserStatusActive,
		EmailVerified:            false,
		VerificationToken:        &token,
		VerificationTokenExpires: &expires,
	}

	if err := db.DB.Create(user).Error; err != nil {
		t.Fatalf("Failed to create unverified test user: %v", err)
	}

	return user
}

// Create2FAEnabledUser creates a user with 2FA enabled for testing.
func Create2FAEnabledUser(t *testing.T, email string) (*models.User, string) {
	t.Helper()

	secret := "TESTSECRETFORTESTING123456"
	user := &models.User{
		Email:         email,
		PasswordHash:  HashPassword("password123"),
		Role:          "buyer",
		Status:        models.UserStatusActive,
		EmailVerified: true,
		TOTPSecret:    &secret,
		TOTPEnabled:   true,
	}

	if err := db.DB.Create(user).Error; err != nil {
		t.Fatalf("Failed to create 2FA enabled test user: %v", err)
	}

	return user, secret
}

// HashPassword hashes a password using bcrypt for test users.
func HashPassword(password string) string {
	// Use a low cost for faster tests
	hash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	return string(hash)
}

// UniqueEmail generates a unique email for testing to avoid conflicts.
func UniqueEmail(prefix string) string {
	return fmt.Sprintf("%s_%d@test.com", prefix, time.Now().UnixNano())
}
