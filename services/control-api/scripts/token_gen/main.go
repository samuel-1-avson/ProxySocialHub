package main

import (
	"fmt"
	"os"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

func main() {
	godotenv.Load("../../.env")
	db.Init(os.Getenv("DATABASE_URL"))

	// 1. Create a test user if not exists
	userID := uuid.New()
	email := "test-provider@example.com"
	
	user := models.User{
		ID: userID,
		Email: email,
		Role: "provider",
	}
	db.DB.FirstOrCreate(&user, models.User{Email: email})

	// 2. Generate a fresh API Key (Provider Token)
	rawToken := "ph_test_" + uuid.New().String()
	hashedToken := models.HashToken(rawToken)

	token := models.ProviderToken{
		ID:       uuid.New(),
		UserID:   user.ID,
		Name:     "CLI-Demo-Token",
		Token:    hashedToken,
		IsActive: true,
	}
	db.DB.Create(&token)

	fmt.Println("--------------------------------------------------")
	fmt.Println("🚀 TEST PROVIDER TOKEN GENERATED")
	fmt.Println("--------------------------------------------------")
	fmt.Println("Token:", rawToken)
	fmt.Println("User:", email)
	fmt.Println("--------------------------------------------------")
    fmt.Println("Use this token with the join command!")
}
