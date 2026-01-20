package main

import (
	"fmt"
	"log"
	"os"

	"github.com/joho/godotenv"
	"github.com/proxyhubb/control-api/internal/models"
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

	fmt.Println("--- COUNTS ---")
	var userCount, listingCount, profileCount int64
	db.Table("users").Count(&userCount)
	db.Table("profiles").Count(&profileCount)
	db.Model(&models.ProxyListing{}).Count(&listingCount)
	fmt.Printf("Users table: %d | Profiles table: %d | Listings table: %d\n", userCount, profileCount, listingCount)

	fmt.Println("\n--- USERS (users table) ---")
	var users []models.User
	db.Table("users").Find(&users)
	for _, u := range users {
		fmt.Printf("ID: %s | Email: %s\n", u.ID, u.Email)
	}

	fmt.Println("\n--- PROFILES (profiles table) ---")
	var profiles []map[string]interface{}
	db.Table("profiles").Find(&profiles)
	for _, p := range profiles {
		fmt.Printf("ID: %v | Email: %v\n", p["id"], p["email"])
	}

	fmt.Println("\n--- LISTINGS ---")
	var listings []models.ProxyListing
	db.Find(&listings)
	for _, l := range listings {
		fmt.Printf("ID: %s | SellerID: %s | Title: %s\n", l.ID, l.SellerID, l.Title)
	}
}
