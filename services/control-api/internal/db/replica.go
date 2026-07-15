package db

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// ReplicaDB is the read-only database connection for analytics
var ReplicaDB *gorm.DB

// InitReadReplica initializes a connection to the read replica
// This is optional and only used when READ_REPLICA_URL is set
func InitReadReplica() error {
	replicaURL := normalizeReadReplicaURL(os.Getenv("READ_REPLICA_URL"))
	if replicaURL == "" {
		log.Println("READ_REPLICA_URL not set, using primary DB for reads")
		ReplicaDB = DB // Fallback to primary
		return nil
	}

	var err error
	ReplicaDB, err = gorm.Open(postgres.Open(replicaURL), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("failed to connect to read replica: %w", err)
	}

	// Configure connection pool for read-heavy workloads
	sqlDB, err := ReplicaDB.DB()
	if err != nil {
		return fmt.Errorf("failed to get replica database instance: %w", err)
	}
	if err := sqlDB.Ping(); err != nil {
		_ = sqlDB.Close()
		log.Printf("Warning: read replica ping failed, using primary DB for reads: %v", err)
		ReplicaDB = DB
		return nil
	}

	// More connections for read-heavy analytics
	sqlDB.SetMaxOpenConns(50)
	sqlDB.SetMaxIdleConns(20)
	sqlDB.SetConnMaxLifetime(time.Hour)
	sqlDB.SetConnMaxIdleTime(10 * time.Minute)

	log.Println("Read replica connected successfully")
	return nil
}

func normalizeReadReplicaURL(raw string) string {
	replicaURL := strings.TrimSpace(raw)
	if replicaURL == "" || strings.HasPrefix(replicaURL, "#") {
		return ""
	}
	if strings.HasPrefix(replicaURL, "postgres://") || strings.HasPrefix(replicaURL, "postgresql://") {
		return replicaURL
	}
	if strings.Contains(replicaURL, "host=") {
		return replicaURL
	}
	log.Printf("Warning: ignoring malformed READ_REPLICA_URL %q; using primary DB for reads", replicaURL)
	return ""
}

// GetReadDB returns the read replica or primary DB
// Use this for all SELECT queries that don't require immediate consistency
func GetReadDB() *gorm.DB {
	if ReplicaDB != nil {
		return ReplicaDB
	}
	return DB
}

// GetWriteDB returns the primary database for write operations
func GetWriteDB() *gorm.DB {
	return DB
}

// CloseReplica closes the read replica connection
func CloseReplica() {
	if ReplicaDB != nil && ReplicaDB != DB {
		sqlDB, err := ReplicaDB.DB()
		if err == nil {
			sqlDB.Close()
			log.Println("Read replica connection closed")
		}
	}
}
