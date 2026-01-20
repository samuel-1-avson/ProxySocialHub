package main

import (
	"fmt"
	"log"
	"os"

	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	godotenv.Load("../../.env")
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL not set")
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal(err)
	}

	// Drop tables with dependencies
	fmt.Println("Dropping problematic tables to fix FK references...")

	// We drop these so GORM recreates them with FKs pointing to 'profiles' instead of 'users'
	db.Exec("DROP TABLE IF EXISTS escrow_transactions CASCADE")
	db.Exec("DROP TABLE IF EXISTS disputes CASCADE")
	db.Exec("DROP TABLE IF EXISTS orders CASCADE")
	db.Exec("DROP TABLE IF EXISTS users CASCADE")

	fmt.Println("Done.")
}
