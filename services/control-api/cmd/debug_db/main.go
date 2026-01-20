package main

import (
	"fmt"
	"log"
	"os"

	"github.com/joho/godotenv"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

func main() {
	// Load .env
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, assuming env vars are set")
	}

	// Initialize DB
	if err := db.Init(os.Getenv("DATABASE_URL")); err != nil {
		log.Fatalf("Failed to connect to DB: %v", err)
	}

	email := "samuelavson@gmail.com"
	fmt.Printf("Checking for user: %s\n", email)

	var user models.User
	if err := db.DB.Where("email = ?", email).First(&user).Error; err != nil {
		fmt.Printf("ERROR: User %s not found in local DB! Error: %v\n", email, err)

		// List all users
		var users []models.User
		db.DB.Find(&users)
		fmt.Printf("Available users in DB (%d):\n", len(users))
		for _, u := range users {
			fmt.Printf(" - %s (%s)\n", u.Email, u.ID)
		}
		return
	}

	fmt.Printf("FOUND User: %s (ID: %s)\n", user.Email, user.ID)

	// Check Sessions
	var sessionCount int64
	db.DB.Model(&models.Session{}).Where("user_id = ?", user.ID).Count(&sessionCount)
	fmt.Printf("Total Sessions: %d\n", sessionCount)

	var activeSessions int64
	db.DB.Model(&models.Session{}).Where("user_id = ? AND status = 'active'", user.ID).Count(&activeSessions)
	fmt.Printf("Active Sessions: %d\n", activeSessions)

	// Check Usage Records
	var usageCount int64
	db.DB.Model(&models.UsageRecord{}).Where("user_id = ?", user.ID).Count(&usageCount)
	fmt.Printf("Usage Records: %d\n", usageCount)

	// Sum Bytes
	var totalBytes int64
	db.DB.Model(&models.UsageRecord{}).Where("user_id = ?", user.ID).Select("COALESCE(SUM(bytes_used), 0)").Scan(&totalBytes)
	fmt.Printf("Total Bytes: %d (%.2f GB)\n", totalBytes, float64(totalBytes)/(1024*1024*1024))
}
