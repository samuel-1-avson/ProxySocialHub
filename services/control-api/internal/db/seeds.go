package db

import (
	"log"

	"os"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

func SeedAll() {
	if DB == nil {
		log.Println("DB not initialized, skipping seeds")
		return
	}

	log.Println("Seeding System Config...")
	seedSystemConfig()
	log.Println("Seeding CLI downloads...")
	SeedCLIDownloads()
	log.Println("Database seeding completed")
}

func stringPtr(s string) *string {
	return &s
}

func seedSystemConfig() {
	configs := []models.SystemConfiguration{
		{
			Key:         "treasury_wallet_solana",
			Value:       os.Getenv("SOLANA_TREASURY_ADDRESS"),
			Description: "Central Treasury Wallet for Solana Deposits",
		},
	}

	for _, c := range configs {
		var existing models.SystemConfiguration
		if err := DB.Where("key = ?", c.Key).First(&existing).Error; err == nil {
			// Update existing record
			if existing.Value != c.Value {
				DB.Model(&existing).Update("value", c.Value)
				log.Printf("Updated config: %s to %s", c.Key, c.Value)
			}
		} else if err == gorm.ErrRecordNotFound {
			// Create new record
			c.ID = uuid.New()
			if err := DB.Create(&c).Error; err != nil {
				log.Printf("Failed to seed config %s: %v", c.Key, err)
			} else {
				log.Printf("Seeded config: %s", c.Key)
			}
		}
	}
}
