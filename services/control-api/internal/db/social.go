package db

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// SocialDB is the Supabase PostgreSQL connection for social/community tables.
// When nil, Social() transparently falls back to the local DB — no code change needed.
var SocialDB *gorm.DB

// Social returns the database connection to use for social/community tables.
// If SUPABASE_DATABASE_URL is configured and InitSocial succeeded, it returns the
// Supabase connection. Otherwise falls back to the local PostgreSQL instance.
func Social() *gorm.DB {
	if SocialDB != nil {
		return SocialDB
	}
	return DB
}

// InitSocial connects to Supabase and auto-migrates all social/community tables.
// If dsn is empty it is a no-op — all queries fall back to the local DB.
func InitSocial(dsn string) error {
	if dsn == "" {
		log.Println("SUPABASE_DATABASE_URL not set — social tables will use local PostgreSQL")
		return nil
	}

	// Switch from Supabase's transaction pooler (port 6543) to session pooler (port 5432).
	// GORM manages its own connection pool, so pgBouncer's transaction mode is redundant
	// and harmful: it resets search_path on every transaction, causing AutoMigrate to fail
	// with "no schema has been selected to create in (SQLSTATE 3F000)".
	// Session pooler preserves connection state for the lifetime of the GORM pool entry.
	dsn = strings.ReplaceAll(dsn, ":6543/", ":5432/")

	var err error
	// PreferSimpleProtocol: true — keep for safety; avoids prepared-statement conflicts.
	// pgBouncer transaction-pool mode does not support named prepared statements; pgx v5
	// creates them at the protocol level regardless of GORM's PrepareStmt setting, which
	// causes "prepared statement already exists (42P05)" on pooled connections.
	// Simple protocol sends every query as a plain text message, avoiding statement caching.
	// Use a 2 s slow-query threshold for the Supabase connection — the remote
	// round-trip alone is ~200–400 ms, so the default 200 ms fires constantly.
	socialLogger := gormlogger.New(
		log.New(os.Stdout, "\r\n[SocialDB] ", log.LstdFlags),
		gormlogger.Config{
			SlowThreshold:             2 * time.Second,
			LogLevel:                  gormlogger.Warn,
			IgnoreRecordNotFoundError: true,
			Colorful:                  false,
		},
	)

	SocialDB, err = gorm.Open(postgres.New(postgres.Config{
		DSN:                  dsn,
		PreferSimpleProtocol: true,
	}), &gorm.Config{PrepareStmt: false, Logger: socialLogger})
	if err != nil {
		SocialDB = nil
		return fmt.Errorf("failed to connect to Supabase DB: %w", err)
	}

	// Configure connection pool (keep low for Supabase pooler)
	sqlDB, err := SocialDB.DB()
	if err != nil {
		SocialDB = nil
		return fmt.Errorf("failed to get Supabase DB instance: %w", err)
	}
	sqlDB.SetMaxOpenConns(5)
	sqlDB.SetMaxIdleConns(2)
	sqlDB.SetConnMaxLifetime(time.Hour)
	sqlDB.SetConnMaxIdleTime(10 * time.Minute)

	// Explicitly set search_path for this connection. Belt-and-suspenders alongside
	// the port switch above — ensures AutoMigrate always targets the public schema.
	if err := SocialDB.Exec("SET search_path TO public").Error; err != nil {
		log.Printf("Warning: failed to set search_path on Supabase connection: %v", err)
	}

	log.Println("Supabase DB connected — migrating social tables...")

	if err := SocialDB.AutoMigrate(
		// Social Graph
		&models.Follow{},
		&models.FriendRequest{},
		&models.Friendship{},
		&models.Badge{},
		&models.UserBadge{},
		&models.FeedEvent{},
		&models.Review{},

		// Notifications
		&models.Notification{},
		&models.NotificationPreference{},

		// Showcase & Stats
		&models.ProviderShowcase{},
		&models.SpeedTest{},
		&models.Testimonial{},
		&models.ProviderStats{},

		// Forum
		&models.ForumCategory{},
		&models.ForumThread{},
		&models.ForumPost{},
		&models.ForumVote{},

		// Messaging
		&models.Conversation{},
		&models.Message{},
		&models.MessageReaction{},

		// Community Circles
		&models.Circle{},
		&models.CircleMember{},
		&models.CircleInvite{},
		&models.CircleSLA{},
		&models.CircleDailyStats{},
		&models.CirclePost{},
		&models.CircleLease{},

		// Subscriptions
		&models.SubscriptionPlan{},
		&models.UserSubscription{},

		// Governance
		&models.Proposal{},
		&models.Vote{},

		// Smart Matching
		&models.UseCase{},
		&models.UserPreference{},
		&models.MatchRequest{},

		// Agents & Automation
		&models.Agent{},
		&models.AgentOutput{},
		&models.MarketAgent{},
		&models.AgentInstance{},
		&models.AgentJob{},
	); err != nil {
		log.Printf("Warning: Supabase social table migration error: %v", err)
		// Don't fail — tables may already exist
	} else {
		log.Println("Supabase social tables ready")
	}

	return nil
}

// CloseSocial closes the Supabase DB connection gracefully.
func CloseSocial() {
	if SocialDB != nil {
		sqlDB, err := SocialDB.DB()
		if err == nil {
			sqlDB.Close()
			log.Println("Supabase DB connection closed")
		}
	}
}
