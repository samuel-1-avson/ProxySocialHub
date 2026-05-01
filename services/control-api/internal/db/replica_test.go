package db

import (
	"os"
	"testing"

	"gorm.io/gorm"
)

func TestInitReadReplicaTreatsWhitespaceAsUnset(t *testing.T) {
	originalURL, hadURL := os.LookupEnv("READ_REPLICA_URL")
	originalReplica := ReplicaDB
	originalDB := DB

	if err := os.Setenv("READ_REPLICA_URL", "   \n\t "); err != nil {
		t.Fatalf("Setenv failed: %v", err)
	}
	DB = &gorm.DB{}
	ReplicaDB = nil

	t.Cleanup(func() {
		if hadURL {
			_ = os.Setenv("READ_REPLICA_URL", originalURL)
		} else {
			_ = os.Unsetenv("READ_REPLICA_URL")
		}
		ReplicaDB = originalReplica
		DB = originalDB
	})

	if err := InitReadReplica(); err != nil {
		t.Fatalf("InitReadReplica returned error for blank DSN: %v", err)
	}

	if ReplicaDB != DB {
		t.Fatal("InitReadReplica did not fall back to the primary DB for a blank DSN")
	}
}
