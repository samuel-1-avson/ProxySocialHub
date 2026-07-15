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

func TestNormalizeReadReplicaURLTreatsCommentPlaceholderAsUnset(t *testing.T) {
	got := normalizeReadReplicaURL("                   # postgresql://user:pass@replica-host:5432/db?sslmode=disable")
	if got != "" {
		t.Fatalf("normalizeReadReplicaURL returned %q, want empty", got)
	}
}

func TestNormalizeReadReplicaURLKeepsPostgresURL(t *testing.T) {
	const dsn = "postgresql://user:pass@replica-host:5432/db?sslmode=disable"
	if got := normalizeReadReplicaURL(dsn); got != dsn {
		t.Fatalf("normalizeReadReplicaURL returned %q, want %q", got, dsn)
	}
}
