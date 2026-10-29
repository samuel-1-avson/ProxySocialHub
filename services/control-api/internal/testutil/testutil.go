package testutil

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"github.com/proxyhubb/control-api/internal/cache"
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
	testDBErr  error // schema could not be built: fail every test, never skip
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

	previousRedisClient := redisInternal.Client
	previousCacheClient := cache.Client
	client := redis.NewClient(&redis.Options{
		Addr: m.Addr(),
	})
	t.Cleanup(func() {
		redisInternal.Client = previousRedisClient
		cache.Client = previousCacheClient
		client.Close()
		m.Close()
	})

	redisInternal.Client = client
	cache.Client = client
}

// SetupTestDB connects the package's tests to a PostgreSQL test database.
//
// Every test binary (one per package; `go test ./...` runs several at once)
// gets its own database, recreated empty and built from migrations/*.up.sql the
// way production builds it, so tests run against the real schema and one
// package's CleanupTestData cannot delete rows another package is using.
// Within a package the database is shared and each test cleans up its own data.
//
// Tests are skipped when no PostgreSQL server is reachable. When the server is
// there but the schema cannot be built, every test fails.
func SetupTestDB(t *testing.T) {
	t.Helper()

	testDBOnce.Do(func() {
		dsn := resolveTestDatabaseDSN()
		if dsn == "" {
			t.Skip("Skipping test: TEST_DATABASE_URL could not be resolved")
			return
		}

		dsn, err := recreatePackageDatabase(dsn)
		if err != nil {
			t.Skipf("Skipping test: Could not prepare test database: %v", err)
			return
		}

		testDB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Error), // Log errors during tests
		})
		if err != nil {
			// If we can't connect, skip the test rather than fail
			// This allows tests to be skipped when no DB is available
			t.Skipf("Skipping test: Could not connect to test database: %v", err)
			return
		}

		if err := buildProductionSchema(testDB); err != nil {
			testDBErr = err
			return
		}
		// profiles.id references auth.users(id). Supabase GoTrue owns that table in
		// production and the API writes the row itself when it creates a user
		// (api/auth.go, api/wallet.go); tests insert profiles directly, so add it here.
		_ = testDB.Callback().Create().After("gorm:before_create").Before("gorm:create").Register("proxyhubb:auth_users_row", func(tx *gorm.DB) {
			if tx.Statement.Schema == nil || tx.Statement.Schema.Table != "profiles" || tx.Statement.Schema.PrioritizedPrimaryField == nil {
				return
			}
			ensure := func(rv reflect.Value) {
				id, zero := tx.Statement.Schema.PrioritizedPrimaryField.ValueOf(tx.Statement.Context, rv)
				if zero {
					return
				}
				conn := tx.Session(&gorm.Session{NewDB: true})
				if res := conn.Exec(`INSERT INTO auth.users (id) VALUES (?) ON CONFLICT (id) DO NOTHING`, id); res.Error == nil && res.RowsAffected == 1 {
					// handle_new_user (000001) just added a stub profile for the new auth row.
					// The insert in progress is the real profile, as in api/auth.go, which
					// upserts over the stub.
					conn.Exec(`DELETE FROM profiles WHERE id = ?`, id)
				}
			}
			switch rv := tx.Statement.ReflectValue; rv.Kind() {
			case reflect.Slice, reflect.Array:
				for i := 0; i < rv.Len(); i++ {
					ensure(reflect.Indirect(rv.Index(i)))
				}
			case reflect.Struct:
				ensure(rv)
			}
		})
		_ = testDB.Callback().Create().Before("gorm:create").Register(defaultProviderNodeIPCallback, defaultProviderNodeIP)
		if err := testDB.Exec(`
			INSERT INTO ledger_accounts (code, name, account_type, created_at) VALUES
			('1000', 'treasury_cash', 'asset', NOW()),
			('2100', 'user_wallet_liability', 'liability', NOW()),
			('2200', 'escrow_liability', 'liability', NOW()),
			('4000', 'platform_revenue', 'income', NOW())
			ON CONFLICT (code) DO NOTHING
		`).Error; err != nil {
			testDBErr = fmt.Errorf("seed ledger_accounts: %w", err)
		}
	})

	if testDBErr != nil {
		t.Fatalf("test database schema: %v", testDBErr)
	}
	if testDB == nil {
		t.Skip("Skipping test: Test database not available")
		return
	}

	// Set the global DB for the api package to use. Write it only when it
	// changes: goroutines started by an earlier test may still be reading it.
	if db.DB != testDB {
		db.DB = testDB
	}
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

// recreatePackageDatabase derives this package's database from the configured
// one (see packageDatabaseName), drops any copy a previous run left behind,
// creates it empty and returns its DSN.
func recreatePackageDatabase(dsn string) (string, error) {
	adminDSN, baseName, err := buildAdminConnection(dsn)
	if err != nil {
		return "", err
	}
	name := packageDatabaseName(baseName)
	if !strings.Contains(name, "test") {
		return "", fmt.Errorf("refusing to recreate %q: test database names must contain \"test\"", name)
	}

	adminDB, err := sql.Open("postgres", adminDSN)
	if err != nil {
		return "", err
	}
	defer adminDB.Close()

	if err := adminDB.Ping(); err != nil {
		return "", err
	}
	// packageDatabaseName yields only [a-z0-9_], so double quotes are enough.
	if _, err := adminDB.Exec(`DROP DATABASE IF EXISTS "` + name + `" WITH (FORCE)`); err != nil {
		return "", fmt.Errorf("drop %s: %w", name, err)
	}
	if _, err := adminDB.Exec(`CREATE DATABASE "` + name + `"`); err != nil {
		return "", fmt.Errorf("create %s: %w", name, err)
	}

	rewritten, ok := rewriteDatabaseName(dsn, name, name)
	if !ok {
		return "", fmt.Errorf("cannot point the test DSN at %s", name)
	}
	return rewritten, nil
}

// packageDatabaseName appends the package's directory, relative to the
// control-api module and without the internal/ prefix, to base as a lower-case
// identifier: proxyhubb_test_api for internal/api.
func packageDatabaseName(base string) string {
	suffix := "tests"
	if wd, err := os.Getwd(); err == nil {
		suffix = filepath.Base(wd)
		if root, ok := findUp(wd, "go.mod"); ok {
			if rel, err := filepath.Rel(root, wd); err == nil {
				suffix = strings.TrimPrefix(filepath.ToSlash(rel), "internal/")
			}
		}
	}
	name := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_':
			return r
		case r >= 'A' && r <= 'Z':
			return r + ('a' - 'A')
		default:
			return '_'
		}
	}, base+"_"+suffix)
	// PostgreSQL truncates identifiers to 63 bytes; keep long names distinct.
	if len(name) > 63 {
		sum := sha256.Sum256([]byte(name))
		name = name[:54] + "_" + hex.EncodeToString(sum[:4])
	}
	return name
}

// findUp returns the first directory at or above dir that contains rel.
func findUp(dir, rel string) (string, bool) {
	for {
		if _, err := os.Stat(filepath.Join(dir, rel)); err == nil {
			return dir, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}

// buildProductionSchema creates the schema the way production does: the
// extensions and Supabase auth stub the postgres container installs at init,
// then every migrations/*.up.sql through db.RunMigrations.
func buildProductionSchema(gdb *gorm.DB) error {
	authStub := filepath.Join("infra", "postgres", "init", "00_auth_schema.sql")
	wd, err := os.Getwd()
	if err != nil {
		return err
	}
	root, ok := findUp(wd, authStub)
	if !ok {
		return fmt.Errorf("repository root (with %s) not found above %s", authStub, wd)
	}

	for _, ext := range []string{"pgcrypto", "uuid-ossp"} {
		if err := gdb.Exec(`CREATE EXTENSION IF NOT EXISTS "` + ext + `"`).Error; err != nil {
			return fmt.Errorf("extension %s: %w", ext, err)
		}
	}
	stub, err := os.ReadFile(filepath.Join(root, authStub))
	if err != nil {
		return err
	}
	if err := gdb.Exec(string(stub)).Error; err != nil {
		return fmt.Errorf("%s: %w", authStub, err)
	}

	// RunMigrations works on db.DB and logs a line per file.
	db.DB = gdb
	prev := log.Writer()
	log.SetOutput(io.Discard)
	defer log.SetOutput(prev)
	return db.RunMigrations(filepath.Join(root, "migrations"))
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

// resolveCleanupTable maps legacy test table aliases to real Postgres names.
func resolveCleanupTable(name string) string {
	switch name {
	case "users", "auth.users":
		return "profiles"
	default:
		return name
	}
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
			// Disable FK checks to allow deleting in any order. SET LOCAL keeps that
			// inside this transaction; a plain SET would stay on whichever pooled
			// connection happened to run it.
			_ = db.DB.Transaction(func(tx *gorm.DB) error {
				if err := tx.Exec("SET LOCAL session_replication_role = 'replica'").Error; err != nil {
					return err
				}
				return tx.Exec(fmt.Sprintf("DELETE FROM %s WHERE 1=1", resolveCleanupTable(table))).Error
			})
		}
	})
}

// CreateTestUser creates a user for testing and returns it.
// The user has email verification enabled and password "password123".
func CreateTestUser(t *testing.T, email, role string) *models.User {
	t.Helper()

	user := &models.User{
		ID:        uuid.New(),
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

// CreateTestUserID creates a user with the given role and returns its ID, for
// fixtures that only need a row the profiles / auth.users foreign keys accept.
func CreateTestUserID(t *testing.T, role string) uuid.UUID {
	t.Helper()
	return CreateTestUser(t, UniqueEmail("fixture-"+role), role).ID
}

// CreateTestWalletID creates a user and returns the ID of the wallet
// CreateTestUser gives it, for fixtures that reference wallets(id).
func CreateTestWalletID(t *testing.T) uuid.UUID {
	t.Helper()
	user := CreateTestUser(t, UniqueEmail("fixture-wallet"), "buyer")
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatalf("load test wallet: %v", err)
	}
	return wallet.ID
}

// CreateTestNodeMirror creates the nodes row that mirrors a provider node and
// returns its ID. sessions.node_id references nodes(id), not provider_nodes(id);
// production links the two through nodes.provider_node_id
// (marketplace.SessionNodeIDForProvider).
func CreateTestNodeMirror(t *testing.T, pn *models.ProviderNode) uuid.UUID {
	t.Helper()
	mirror := models.Node{
		ID:             uuid.New(),
		UserID:         pn.UserID,
		ProviderUserID: pn.UserID,
		ProviderNodeID: &pn.ID,
		GatewayNodeID:  pn.GatewayNodeID,
		IPAddress:      pn.IPAddress,
		Port:           pn.Port,
		IsHealthy:      pn.IsHealthy,
	}
	if err := db.DB.Create(&mirror).Error; err != nil {
		t.Fatalf("create node mirror: %v", err)
	}
	return mirror.ID
}

// CreateTestProviderNode creates a healthy, online provider node with spare
// capacity for owner and its nodes mirror, which is what session and order
// creation select. It returns the node and the mirror ID (sessions.node_id).
func CreateTestProviderNode(t *testing.T, ownerID uuid.UUID) (*models.ProviderNode, uuid.UUID) {
	t.Helper()
	now := time.Now()
	pn := &models.ProviderNode{
		ID:             uuid.New(),
		UserID:         ownerID,
		Name:           "test-node",
		Status:         models.NodeOnline,
		IsHealthy:      true,
		IPAddress:      "10.0.0.5",
		Port:           1080,
		MaxConnections: 100,
		GatewayNodeID:  "node_" + ownerID.String(),
		LastSeenAt:     &now,
	}
	if err := db.DB.Create(pn).Error; err != nil {
		t.Fatalf("create provider node: %v", err)
	}
	return pn, CreateTestNodeMirror(t, pn)
}

// CreateTestListing creates an active proxy listing for seller and returns it.
func CreateTestListing(t *testing.T, sellerID uuid.UUID) *models.ProxyListing {
	t.Helper()
	listing := &models.ProxyListing{
		SellerID:             sellerID,
		Title:                "test listing",
		PricePerGB:           1,
		AvailableBandwidthGB: 10,
		MaxConcurrency:       1,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(listing).Error; err != nil {
		t.Fatalf("create test listing: %v", err)
	}
	return listing
}

// UniqueEmail generates a unique email for testing to avoid conflicts.
func UniqueEmail(prefix string) string {
	return fmt.Sprintf("%s_%d@test.com", prefix, time.Now().UnixNano())
}

// SetupTestRouter creates a gin router for testing
const defaultProviderNodeIPCallback = "proxyhubb:default_provider_node_ip"

// defaultProviderNodeIP gives a ProviderNode created without an address the placeholder
// 10.0.0.5. provider_nodes.ip_address is inet, which rejects an empty string, so without this the
// many tests that create a bare node would fail on a constraint they are not about.
//
// Production has no such hook. A ProviderNode created there without an address is inserted with
// an empty string and the insert fails (SQLSTATE 22P02), which no test noticed because of this
// placeholder.
// Use WithoutProviderNodeIPDefault in a test that must see the insert as production does.
func defaultProviderNodeIP(tx *gorm.DB) {
	node, ok := tx.Statement.Dest.(*models.ProviderNode)
	if !ok || node == nil || node.IPAddress != "" {
		return
	}
	node.IPAddress = "10.0.0.5"
}

// WithoutProviderNodeIPDefault turns the placeholder above off for one test, so a ProviderNode
// created without an address is inserted exactly as production inserts it. Call it after
// SetupTestDB.
func WithoutProviderNodeIPDefault(t *testing.T) {
	t.Helper()
	cb := testDB.Callback().Create()
	if err := cb.Remove(defaultProviderNodeIPCallback); err != nil {
		t.Fatalf("remove the provider node address placeholder: %v", err)
	}
	t.Cleanup(func() {
		_ = cb.Before("gorm:create").Register(defaultProviderNodeIPCallback, defaultProviderNodeIP)
	})
}

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
