package db

import (
	"fmt"
	"log"
	"os"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

// Minimal Models
type User struct {
	ID            uuid.UUID `gorm:"type:uuid;primary_key"`
	Email         string
	Role          string
	WalletAddress *string
	Wallet        Wallet `gorm:"foreignKey:UserID"`
}

type Wallet struct {
	ID       uuid.UUID `gorm:"type:uuid;primary_key"`
	UserID   uuid.UUID
	Balance  float64
	Currency string
}

type WalletLedgerEntry struct {
	ID           uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	WalletID     uuid.UUID `gorm:"type:uuid;not null"`
	Amount       float64
	BalanceAfter float64
	Type         string
	Description  string
	CreatedAt    time.Time
}

func Connect() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		// Default local DSN
		dsn = "host=localhost user=postgres password=postgres dbname=proxyhub port=5432 sslmode=disable"
	}

	var err error
	DB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	log.Println("Connected to Database")
}

// GetCandidatesForPayout returns providers with balance > threshold and a valid wallet address
func GetCandidatesForPayout(threshold float64) ([]User, error) {
	var users []User
	// Join User and Wallet. Filter by Role=provider, Balance > threshold, WalletAddress IS NOT NULL
	err := DB.Joins("Wallet").
		Where("users.role = ? AND users.wallet_address IS NOT NULL AND \"Wallet\".balance >= ?", "provider", threshold).
		Find(&users).Error
	return users, err
}

// RecordPayout deducts from wallet and records ledger entry
func RecordPayout(userID uuid.UUID, amount float64, txHash string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var wallet Wallet
		if err := tx.Where("user_id = ?", userID).First(&wallet).Error; err != nil {
			return err
		}

		if wallet.Balance < amount {
			return fmt.Errorf("insufficient balance for payout")
		}

		newBalance := wallet.Balance - amount

		// Update Wallet
		if err := tx.Model(&wallet).Update("balance", newBalance).Error; err != nil {
			return err
		}

		// Create Ledger Entry
		ledger := WalletLedgerEntry{
			ID:           uuid.New(),
			WalletID:     wallet.ID,
			Amount:       -amount, // Negative for deduction
			BalanceAfter: newBalance,
			Type:         "payout",
			Description:  fmt.Sprintf("Automated Payout: %s", txHash),
			CreatedAt:    time.Now(),
		}
		if err := tx.Create(&ledger).Error; err != nil {
			return err
		}

		return nil
	})
}
