package main

import (
	"log"
	"os"

	"github.com/joho/godotenv"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	// Try to load from root .env
	godotenv.Load("../../.env")
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL not set")
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal(err)
	}

	log.Println("Migrating Explorer tables...")
	err = db.AutoMigrate(
		&models.ExplorerBlock{},
		&models.ExplorerTransaction{},
		&models.ExplorerNode{},
		&models.ExplorerContract{},
		&models.ExplorerMetrics{},
	)
	if err != nil {
		log.Fatalf("Migration failed: %v", err)
	}
	log.Println("Explorer tables migrated successfully!")
}
