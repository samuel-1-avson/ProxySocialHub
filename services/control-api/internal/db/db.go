package db

import (
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

var DB *gorm.DB

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
	// Schema migrations only run when AUTO_MIGRATE=true is explicitly set.
	// In production, set this only in the dedicated migration init-container or job.
	// Normal API replicas leave AUTO_MIGRATE unset so that:
	//   1. Pod startup is fast (no DDL locking PgBouncer/Supabase connections)
	//   2. A failed migration cannot silently start an API pod with a broken schema
	if os.Getenv("AUTO_MIGRATE") != "true" {
		log.Println("AUTO_MIGRATE is not set — skipping schema migration " +
			"(set AUTO_MIGRATE=true in migration containers/jobs to apply schema changes)")
		return nil
	}

	// P3-14: Run versioned SQL migrations from the migrations directory instead
	// of relying on GORM AutoMigrate.  MIGRATIONS_DIR env var overrides the
	// default path (/app/migrations in Docker, ../../migrations in local dev).
	if err := RunMigrations(os.Getenv("MIGRATIONS_DIR")); err != nil {
		return fmt.Errorf("db: migration runner failed: %w", err)
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
