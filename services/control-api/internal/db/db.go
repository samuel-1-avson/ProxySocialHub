package db

import (
	"log"
	"os"

	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

func Init() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Println("DATABASE_URL not set, skipping DB connection")
		return
	}

	var err error
	DB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	log.Println("Database connected successfully")

	// Enable uuid-ossp extension
	if err := DB.Exec("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"").Error; err != nil {
		log.Printf("Warning: Failed to enable uuid-ossp extension: %v", err)
	}

	// Auto-migrate schema
	err = DB.AutoMigrate(
		&models.User{},
		&models.OAuthIdentity{},
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
		log.Fatalf("Failed to migrate database: %v", err)
	}
	log.Println("Database migrations applied")
}
