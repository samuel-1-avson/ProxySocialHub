package testutil

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
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
		dsn := resolveTestDatabaseDSN()
		if dsn == "" {
			t.Skip("Skipping test: TEST_DATABASE_URL could not be resolved")
			return
		}

		if err := ensureTestDatabaseExists(dsn); err != nil {
			t.Skipf("Skipping test: Could not prepare test database: %v", err)
			return
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
			&models.MarketAgent{},
			&models.AgentInstance{},
			&models.AgentJob{},
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

func resolveTestDatabaseDSN() string {
	if dsn := os.Getenv("TEST_DATABASE_URL"); dsn != "" {
		return dsn
	}

	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		if rewritten, ok := rewriteDatabaseName(dsn, os.Getenv("TEST_DATABASE_NAME"), resolveTestDatabaseName("")); ok {
			return rewritten
		}
	}

	host := getenvDefault("TEST_DATABASE_HOST", getenvDefault("POSTGRES_HOST", "127.0.0.1"))
	port := getenvDefault("TEST_DATABASE_PORT", getenvDefault("POSTGRES_HOST_PORT", "55432"))
	user := getenvDefault("TEST_DATABASE_USER", getenvDefault("POSTGRES_USER", "proxyhubb"))
	password := getenvDefault("TEST_DATABASE_PASSWORD", getenvDefault("POSTGRES_PASSWORD", "proxyhubb"))
	sslMode := getenvDefault("TEST_DATABASE_SSLMODE", "disable")
	name := resolveTestDatabaseName(getenvDefault("POSTGRES_DB", "proxyhubb"))

	return fmt.Sprintf(
		"host=%s user=%s password=%s dbname=%s port=%s sslmode=%s",
		host,
		user,
		password,
		name,
		port,
		sslMode,
	)
}

func resolveTestDatabaseName(base string) string {
	if explicit := os.Getenv("TEST_DATABASE_NAME"); explicit != "" {
		return explicit
	}
	if base == "" {
		base = "proxyhubb"
	}
	if base == "postgres" {
		base = "proxyhubb"
	}
	return base + "_test"
}

func rewriteDatabaseName(dsn, explicitTestName, fallbackTestName string) (string, bool) {
	parsedURL, err := url.Parse(dsn)
	if err == nil && parsedURL.Scheme != "" {
		testName := fallbackTestName
		if explicitTestName != "" {
			testName = explicitTestName
		}
		parsedURL.Path = "/" + testName
		query := parsedURL.Query()
		if query.Get("sslmode") == "" {
			query.Set("sslmode", getenvDefault("TEST_DATABASE_SSLMODE", "disable"))
		}
		parsedURL.RawQuery = query.Encode()
		return parsedURL.String(), true
	}

	parts := map[string]string{}
	for _, token := range splitDSNTokens(dsn) {
		key, value, ok := splitDSNToken(token)
		if !ok {
			continue
		}
		parts[key] = value
	}
	if len(parts) == 0 {
		return "", false
	}
	parts["dbname"] = resolveTestDatabaseName(parts["dbname"])
	if explicitTestName != "" {
		parts["dbname"] = explicitTestName
	}
	if _, ok := parts["sslmode"]; !ok {
		parts["sslmode"] = getenvDefault("TEST_DATABASE_SSLMODE", "disable")
	}

	orderedKeys := []string{"host", "user", "password", "dbname", "port", "sslmode"}
	ordered := make([]string, 0, len(parts))
	for _, key := range orderedKeys {
		if value, ok := parts[key]; ok {
			ordered = append(ordered, fmt.Sprintf("%s=%s", key, value))
			delete(parts, key)
		}
	}
	for key, value := range parts {
		ordered = append(ordered, fmt.Sprintf("%s=%s", key, value))
		_ = key
		_ = value
	}
	return joinDSNTokens(ordered), true
}

func splitDSNTokens(dsn string) []string {
	result := make([]string, 0)
	current := ""
	inQuote := false
	for _, ch := range dsn {
		switch ch {
		case '\'':
			inQuote = !inQuote
			current += string(ch)
		case ' ':
			if inQuote {
				current += string(ch)
			} else if current != "" {
				result = append(result, current)
				current = ""
			}
		default:
			current += string(ch)
		}
	}
	if current != "" {
		result = append(result, current)
	}
	return result
}

func splitDSNToken(token string) (string, string, bool) {
	for index := 0; index < len(token); index++ {
		if token[index] != '=' {
			continue
		}
		return token[:index], token[index+1:], true
	}
	return "", "", false
}

func joinDSNTokens(tokens []string) string {
	joined := ""
	for index, token := range tokens {
		if index > 0 {
			joined += " "
		}
		joined += token
	}
	return joined
}

func ensureTestDatabaseExists(dsn string) error {
	adminDSN, testDBName, err := buildAdminConnection(dsn)
	if err != nil {
		return err
	}

	adminDB, err := sql.Open("postgres", adminDSN)
	if err != nil {
		return err
	}
	defer adminDB.Close()

	if err := adminDB.Ping(); err != nil {
		return err
	}

	var exists int
	if err := adminDB.QueryRow("SELECT 1 FROM pg_database WHERE datname = $1", testDBName).Scan(&exists); err == sql.ErrNoRows {
		if _, createErr := adminDB.Exec(`CREATE DATABASE "` + testDBName + `"`); createErr != nil {
			return createErr
		}
		return nil
	} else if err != nil {
		return err
	}

	return nil
}

func buildAdminConnection(dsn string) (string, string, error) {
	parsedURL, err := url.Parse(dsn)
	if err == nil && parsedURL.Scheme != "" {
		testDBName := parsedURL.Path
		if len(testDBName) > 0 && testDBName[0] == '/' {
			testDBName = testDBName[1:]
		}
		adminURL := *parsedURL
		adminURL.Path = "/postgres"
		return adminURL.String(), testDBName, nil
	}

	parts := map[string]string{}
	for _, token := range splitDSNTokens(dsn) {
		key, value, ok := splitDSNToken(token)
		if ok {
			parts[key] = value
		}
	}
	testDBName := parts["dbname"]
	if testDBName == "" {
		return "", "", fmt.Errorf("dsn missing dbname")
	}
	parts["dbname"] = getenvDefault("TEST_DATABASE_ADMIN_DB", "postgres")
	ordered := []string{
		fmt.Sprintf("host=%s", parts["host"]),
		fmt.Sprintf("user=%s", parts["user"]),
		fmt.Sprintf("password=%s", parts["password"]),
		fmt.Sprintf("dbname=%s", parts["dbname"]),
		fmt.Sprintf("port=%s", parts["port"]),
		fmt.Sprintf("sslmode=%s", parts["sslmode"]),
	}
	return joinDSNTokens(ordered), testDBName, nil
}

func getenvDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
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
	}

	if err := db.DB.Create(user).Error; err != nil {
		t.Fatalf("Failed to create test user: %v", err)
	}

	// Create associated wallet (SOL-only)
	wallet := &models.Wallet{
		UserID:     user.ID,
		BalanceSOL: 10.0, // Start with some SOL balance for testing
	}
	db.DB.Create(wallet)

	return user
}

// UniqueEmail generates a unique email for testing to avoid conflicts.
func UniqueEmail(prefix string) string {
	return fmt.Sprintf("%s_%d@test.com", prefix, time.Now().UnixNano())
}

// SetupTestRouter creates a gin router for testing
func SetupTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(gin.Recovery())
	return r
}

// GetTestUserID returns a consistent UUID for testing
func GetTestUserID() string {
	return "00000000-0000-0000-0000-000000000001"
}
