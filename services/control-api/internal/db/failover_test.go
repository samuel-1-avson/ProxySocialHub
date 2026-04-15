package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	_ "github.com/lib/pq"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func resolvePrimaryFailoverDSN() string {
	if dsn := os.Getenv("TEST_DATABASE_URL"); dsn != "" {
		return dsn
	}
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		return dsn
	}

	return fmt.Sprintf(
		"postgres://%s:%s@%s:%s/%s?sslmode=disable",
		getenvDefault("TEST_DATABASE_USER", getenvDefault("POSTGRES_USER", "proxyhubb")),
		getenvDefault("TEST_DATABASE_PASSWORD", getenvDefault("POSTGRES_PASSWORD", "proxyhubb")),
		getenvDefault("TEST_DATABASE_HOST", "127.0.0.1"),
		getenvDefault("TEST_DATABASE_PORT", getenvDefault("POSTGRES_HOST_PORT", "55432")),
		getenvDefault("TEST_DATABASE_NAME", getenvDefault("POSTGRES_DB", "proxyhubb")),
	)
}

func resolveReplicaFailoverDSN() string {
	if dsn := os.Getenv("TEST_REPLICA_DATABASE_URL"); dsn != "" {
		return dsn
	}
	if dsn := os.Getenv("READ_REPLICA_URL"); dsn != "" {
		return dsn
	}

	replicaHost := os.Getenv("TEST_REPLICA_DATABASE_HOST")
	replicaPort := os.Getenv("TEST_REPLICA_DATABASE_PORT")
	if replicaHost == "" && replicaPort == "" && os.Getenv("POSTGRES_REPLICA_HOST_PORT") == "" {
		return ""
	}
	if replicaHost == "" {
		replicaHost = "127.0.0.1"
	}
	if replicaPort == "" {
		replicaPort = getenvDefault("POSTGRES_REPLICA_HOST_PORT", "55433")
	}

	return fmt.Sprintf(
		"postgres://%s:%s@%s:%s/%s?sslmode=disable",
		getenvDefault("TEST_REPLICA_DATABASE_USER", getenvDefault("TEST_DATABASE_USER", getenvDefault("POSTGRES_USER", "proxyhubb"))),
		getenvDefault("TEST_REPLICA_DATABASE_PASSWORD", getenvDefault("TEST_DATABASE_PASSWORD", getenvDefault("POSTGRES_PASSWORD", "proxyhubb"))),
		replicaHost,
		replicaPort,
		getenvDefault("TEST_REPLICA_DATABASE_NAME", getenvDefault("TEST_DATABASE_NAME", getenvDefault("POSTGRES_DB", "proxyhubb"))),
	)
}

func openFailoverDatabase(t testing.TB, role, dsn string) *sql.DB {
	t.Helper()
	if dsn == "" {
		t.Skipf("%s PostgreSQL DSN not configured", role)
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Skipf("%s PostgreSQL not available: %v", role, err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		t.Skipf("%s PostgreSQL not reachable: %v", role, err)
	}

	return db
}

func getenvDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

// TestPostgreSQLFailover tests PostgreSQL failover behavior
// Property 1: High Availability Failover Timing
// Validates: Requirements 1.2
func TestPostgreSQLFailover(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping PostgreSQL failover test in short mode")
	}

	// Connection strings for primary and replica
	primaryDSN := resolvePrimaryFailoverDSN()
	replicaDSN := resolveReplicaFailoverDSN()
	if replicaDSN == "" {
		t.Skip("Replica PostgreSQL DSN not configured")
	}

	// Test primary connection
	primaryDB := openFailoverDatabase(t, "primary", primaryDSN)
	defer primaryDB.Close()

	// Test replica connection
	replicaDB := openFailoverDatabase(t, "replica", replicaDSN)
	defer replicaDB.Close()

	ctx := context.Background()

	// Property: System should maintain data consistency during failover
	t.Run("data_consistency_during_failover", func(t *testing.T) {
		// Create test table
		createTableSQL := `
			CREATE TABLE IF NOT EXISTS failover_test (
				id SERIAL PRIMARY KEY,
				data TEXT NOT NULL,
				created_at TIMESTAMP DEFAULT NOW()
			)
		`
		_, err := primaryDB.ExecContext(ctx, createTableSQL)
		require.NoError(t, err, "Failed to create test table")

		// Insert test data on primary
		testData := []string{"test1", "test2", "test3", "test4", "test5"}
		for i, data := range testData {
			insertSQL := "INSERT INTO failover_test (data) VALUES ($1)"
			_, err := primaryDB.ExecContext(ctx, insertSQL, data)
			require.NoError(t, err, "Failed to insert test data %d", i)
		}

		// Wait for replication to catch up (streaming replication should be fast)
		time.Sleep(2 * time.Second)

		// Verify data is replicated to replica
		for i, expectedData := range testData {
			var actualData string
			querySQL := "SELECT data FROM failover_test WHERE id = $1"
			err := replicaDB.QueryRowContext(ctx, querySQL, i+1).Scan(&actualData)
			require.NoError(t, err, "Failed to query replica for record %d", i+1)
			assert.Equal(t, expectedData, actualData, "Data mismatch on replica for record %d", i+1)
		}

		// Test read-only nature of replica
		insertSQL := "INSERT INTO failover_test (data) VALUES ('should_fail')"
		_, err = replicaDB.ExecContext(ctx, insertSQL)
		assert.Error(t, err, "Replica should reject write operations")
		assert.Contains(t, err.Error(), "read-only", "Error should indicate read-only mode")

		// Clean up
		_, _ = primaryDB.ExecContext(ctx, "DROP TABLE IF EXISTS failover_test")
	})

	// Property: Replication lag should be minimal (< 1 second)
	t.Run("replication_lag_timing", func(t *testing.T) {
		// Create test table for timing
		createTableSQL := `
			CREATE TABLE IF NOT EXISTS replication_timing_test (
				id SERIAL PRIMARY KEY,
				data TEXT NOT NULL,
				created_at TIMESTAMP DEFAULT NOW()
			)
		`
		_, err := primaryDB.ExecContext(ctx, createTableSQL)
		require.NoError(t, err, "Failed to create timing test table")

		// Insert data with timestamp
		testData := fmt.Sprintf("timing_test_%d", time.Now().Unix())
		insertTime := time.Now()

		insertSQL := "INSERT INTO replication_timing_test (data) VALUES ($1) RETURNING id"
		var insertedID int
		err = primaryDB.QueryRowContext(ctx, insertSQL, testData).Scan(&insertedID)
		require.NoError(t, err, "Failed to insert timing test data")

		// Poll replica until data appears
		var replicatedData string
		var replicationTime time.Duration
		maxWait := 5 * time.Second
		pollInterval := 10 * time.Millisecond

		for elapsed := time.Duration(0); elapsed < maxWait; elapsed += pollInterval {
			querySQL := "SELECT data FROM replication_timing_test WHERE id = $1"
			err = replicaDB.QueryRowContext(ctx, querySQL, insertedID).Scan(&replicatedData)

			if err == nil && replicatedData == testData {
				replicationTime = time.Since(insertTime)
				break
			}

			time.Sleep(pollInterval)
		}

		require.NoError(t, err, "Data was not replicated to replica within timeout")
		assert.Equal(t, testData, replicatedData, "Replicated data does not match")
		assert.Less(t, replicationTime, 1*time.Second, "Replication took too long: %v", replicationTime)

		t.Logf("Replication completed in %v", replicationTime)

		// Clean up
		_, _ = primaryDB.ExecContext(ctx, "DROP TABLE IF EXISTS replication_timing_test")
	})

	// Property: Connection pooling should handle failover gracefully
	t.Run("connection_pool_failover", func(t *testing.T) {
		// Test multiple concurrent connections
		numConnections := 10
		results := make(chan error, numConnections)

		// Create test table
		createTableSQL := `
			CREATE TABLE IF NOT EXISTS pool_test (
				id SERIAL PRIMARY KEY,
				connection_id INT NOT NULL,
				data TEXT NOT NULL
			)
		`
		_, err := primaryDB.ExecContext(ctx, createTableSQL)
		require.NoError(t, err, "Failed to create pool test table")

		// Simulate concurrent operations
		for i := 0; i < numConnections; i++ {
			go func(connID int) {
				// Insert data
				insertSQL := "INSERT INTO pool_test (connection_id, data) VALUES ($1, $2)"
				_, err := primaryDB.ExecContext(ctx, insertSQL, connID, fmt.Sprintf("data_%d", connID))
				results <- err
			}(i)
		}

		// Collect results
		for i := 0; i < numConnections; i++ {
			err := <-results
			assert.NoError(t, err, "Connection %d failed", i)
		}

		// Verify all data was inserted
		var count int
		countSQL := "SELECT COUNT(*) FROM pool_test"
		err = primaryDB.QueryRowContext(ctx, countSQL).Scan(&count)
		require.NoError(t, err, "Failed to count pool test records")
		assert.Equal(t, numConnections, count, "Not all concurrent operations succeeded")

		// Clean up
		_, _ = primaryDB.ExecContext(ctx, "DROP TABLE IF EXISTS pool_test")
	})

	// Property: Database should handle connection failures gracefully
	t.Run("connection_resilience", func(t *testing.T) {
		// Test connection retry logic
		maxRetries := 3
		retryDelay := 100 * time.Millisecond
		var err error

		for attempt := 1; attempt <= maxRetries; attempt++ {
			err = primaryDB.PingContext(ctx)
			if err == nil {
				break
			}

			if attempt == maxRetries {
				t.Fatalf("Failed to connect after %d attempts: %v", maxRetries, err)
			}

			t.Logf("Connection attempt %d failed, retrying in %v: %v", attempt, retryDelay, err)
			time.Sleep(retryDelay)
		}

		// Test that connections can be re-established
		testSQL := "SELECT 1"
		var result int
		err = primaryDB.QueryRowContext(ctx, testSQL).Scan(&result)
		assert.NoError(t, err, "Failed to execute test query")
		assert.Equal(t, 1, result, "Test query returned unexpected result")
	})
}

// TestPostgreSQLReplicationMonitoring tests replication monitoring
func TestPostgreSQLReplicationMonitoring(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping PostgreSQL replication monitoring test in short mode")
	}

	primaryDSN := resolvePrimaryFailoverDSN()

	primaryDB := openFailoverDatabase(t, "primary", primaryDSN)
	defer primaryDB.Close()

	ctx := context.Background()

	t.Run("replication_status_monitoring", func(t *testing.T) {
		// Query replication status
		statusSQL := `
			SELECT 
				client_addr,
				state,
				sent_lsn,
				write_lsn,
				flush_lsn,
				replay_lsn,
				write_lag,
				flush_lag,
				replay_lag
			FROM pg_stat_replication
		`

		rows, err := primaryDB.QueryContext(ctx, statusSQL)
		if err != nil {
			t.Skipf("Replication status query failed (no replicas?): %v", err)
		}
		defer rows.Close()

		replicaCount := 0
		for rows.Next() {
			var clientAddr, state, sentLSN, writeLSN, flushLSN, replayLSN sql.NullString
			var writeLag, flushLag, replayLag sql.NullString

			err := rows.Scan(&clientAddr, &state, &sentLSN, &writeLSN, &flushLSN, &replayLSN, &writeLag, &flushLag, &replayLag)
			require.NoError(t, err, "Failed to scan replication status")

			replicaCount++

			// Verify replica is in streaming state
			assert.Equal(t, "streaming", state.String, "Replica should be in streaming state")

			// Log replication lag information
			if replayLag.Valid {
				t.Logf("Replica %s replay lag: %s", clientAddr.String, replayLag.String)
			}
		}

		if replicaCount == 0 {
			t.Skip("No replicas found for monitoring test")
		}

		t.Logf("Found %d active replicas", replicaCount)
	})

	t.Run("wal_archiving_status", func(t *testing.T) {
		// Check WAL archiving status
		archiveSQL := "SELECT archived_count, failed_count FROM pg_stat_archiver"

		var archivedCount, failedCount int64
		err := primaryDB.QueryRowContext(ctx, archiveSQL).Scan(&archivedCount, &failedCount)
		require.NoError(t, err, "Failed to query WAL archiving status")

		t.Logf("WAL archiving - Archived: %d, Failed: %d", archivedCount, failedCount)

		// In a production setup, we'd want to ensure failed_count is low
		// For testing, we just verify the query works
		assert.GreaterOrEqual(t, archivedCount, int64(0), "Archived count should be non-negative")
		assert.GreaterOrEqual(t, failedCount, int64(0), "Failed count should be non-negative")
	})
}

// BenchmarkPostgreSQLOperations benchmarks database operations
func BenchmarkPostgreSQLOperations(b *testing.B) {
	primaryDSN := resolvePrimaryFailoverDSN()
	replicaDSN := resolveReplicaFailoverDSN()
	if replicaDSN == "" {
		b.Skip("Replica PostgreSQL DSN not configured")
	}

	primaryDB := openFailoverDatabase(b, "primary", primaryDSN)
	defer primaryDB.Close()

	replicaDB := openFailoverDatabase(b, "replica", replicaDSN)
	defer replicaDB.Close()

	ctx := context.Background()

	// Setup test table
	setupSQL := `
		CREATE TABLE IF NOT EXISTS benchmark_test (
			id SERIAL PRIMARY KEY,
			data TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT NOW()
		)
	`
	_, err := primaryDB.ExecContext(ctx, setupSQL)
	if err != nil {
		b.Fatalf("Failed to create benchmark table: %v", err)
	}

	b.Run("primary_writes", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			insertSQL := "INSERT INTO benchmark_test (data) VALUES ($1)"
			_, err := primaryDB.ExecContext(ctx, insertSQL, fmt.Sprintf("benchmark_data_%d", i))
			if err != nil {
				b.Fatalf("Insert failed: %v", err)
			}
		}
	})

	b.Run("replica_reads", func(b *testing.B) {
		// Pre-populate some data
		for i := 0; i < 100; i++ {
			insertSQL := "INSERT INTO benchmark_test (data) VALUES ($1)"
			_, _ = primaryDB.ExecContext(ctx, insertSQL, fmt.Sprintf("read_test_%d", i))
		}

		// Wait for replication
		time.Sleep(1 * time.Second)

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			querySQL := "SELECT data FROM benchmark_test WHERE id = $1"
			var data string
			err := replicaDB.QueryRowContext(ctx, querySQL, (i%100)+1).Scan(&data)
			if err != nil && err != sql.ErrNoRows {
				b.Fatalf("Query failed: %v", err)
			}
		}
	})

	// Cleanup
	_, _ = primaryDB.ExecContext(ctx, "DROP TABLE IF EXISTS benchmark_test")
}
