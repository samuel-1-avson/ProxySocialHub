package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	// Import strictly necessary parts or define inline/stub models to avoid complex dependencies
	// For this script, defining inline models is safer to avoid import cycles or path issues
	// if the project structure is complex.
	// However, importing the actual internal packages is better if paths are standard.
	// Given the path `c:\Users\samue\Desktop\project\proxyhubb\services\control-api`, the module name should be checked.
	// Assuming module name is `github.com/proxyhubb/control-api` or similar as per `go.mod`.
	// Let's use relative imports or just assume we run this from `services/control-api` root.
	// Ideally I'd use the `internal` packages but `main` can't import `internal`.
	// So I must place this script inside `internal` or `cmd` and use the module name.
	// Let's define structs inline for simplicity and robustness.
)

type Wallet struct {
	ID       string `gorm:"type:uuid;primaryKey"`
	UserID   string `gorm:"unique"`
	Balance  float64
	Currency string
}

type WalletLedgerEntry struct {
	ID          string `gorm:"type:uuid;primaryKey"`
	WalletID    string `gorm:"type:uuid"`
	Amount      float64
	Type        string
	ReferenceID string
	Description string
	CreatedAt   string
}

type PendingTransaction struct {
	ID        string `gorm:"type:uuid;primaryKey"`
	UserID    string
	Reference string
	Type      string
	Amount    float64
	Status    string
	CreatedAt string
}

func main() {
	// Load .env
	if err := godotenv.Load(); err != nil {
		// Try loading from parent dir if not found
		_ = godotenv.Load("../../.env")
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL not set")
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal(err)
	}

	// Fetch all data for debugging
	// Ideally we filter by the user in the screenshot if we knew the ID, but we can dump recent ones.

	fmt.Println("--- RECENT PENDING TRANSACTIONS (Last 5) ---")
	var pending []PendingTransaction
	db.Order("created_at desc").Limit(5).Find(&pending)
	printJSON(pending)

	fmt.Println("\n--- RECENT LEDGER ENTRIES (Last 5) ---")
	var ledger []WalletLedgerEntry
	db.Order("created_at desc").Limit(5).Find(&ledger)
	printJSON(ledger)

	fmt.Println("\n--- WALLETS ---")
	var wallets []Wallet
	// fetch wallets related to these transactions
	userIDs := make([]string, 0)
	for _, p := range pending {
		userIDs = append(userIDs, p.UserID)
	}
	db.Where("user_id IN ?", userIDs).Find(&wallets)
	printJSON(wallets)
}

func printJSON(v interface{}) {
	b, _ := json.MarshalIndent(v, "", "  ")
	fmt.Println(string(b))
}
