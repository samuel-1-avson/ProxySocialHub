package main

import (
	"log"
	"os"

	"github.com/joho/godotenv"
	"github.com/proxyhubb/control-api/internal/db"
)

func main() {
	// Try loading .env file from current directory (when running from services/control-api)
	if err := godotenv.Load(); err != nil {
		log.Println("Note: .env file not found or error loading it")
	}

	if os.Getenv("DATABASE_URL") == "" {
		// Fallback for local dev if not set
		log.Println("DATABASE_URL must be set")
		os.Exit(1)
	}

	log.Println("Starting Database Seeder...")

	db.Init(os.Getenv("DATABASE_URL"))
	db.SeedAll()

	log.Println("Seeding complete!")
}
