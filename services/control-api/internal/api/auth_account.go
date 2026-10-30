package api

import (
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// errAccountWallet marks a failure creating the custodial ledger wallet row.
var errAccountWallet = errors.New("create wallet")

// createAccount inserts auth.users + profiles (default role buyer) and the custodial
// ledger wallet row, inside tx. walletAddress may be nil (e.g. Google sign-up sets it
// after the embedded wallet exists). Shared by wallet and Google sign-up.
func createAccount(tx *gorm.DB, email, username string, walletAddress *string) (models.User, error) {
	var user models.User

	// Insert into auth.users first (profiles.id has FK to auth.users.id)
	// Use ON CONFLICT to handle retries (orphan rows from previous failed attempts)
	var newID uuid.UUID
	authUserSQL := `INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
		VALUES ($1, $2, '{}', NOW(), NOW())
		ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
		RETURNING id`
	row := tx.Raw(authUserSQL, uuid.New(), email).Row()
	if row == nil {
		return user, fmt.Errorf("auth.users insert: nil row")
	}
	if err := row.Scan(&newID); err != nil {
		return user, fmt.Errorf("auth.users insert: %w", err)
	}

	// Insert profile (raw SQL to ensure our UUID is used, GORM Create may override)
	profileSQL := `INSERT INTO profiles (id, email, role, status, trust_tier, wallet_address, username, created_at, updated_at)
		VALUES ($1, $2, 'buyer', 'active', 'new', $3, $4, NOW(), NOW())
		ON CONFLICT (id) DO UPDATE SET wallet_address = COALESCE(EXCLUDED.wallet_address, profiles.wallet_address), updated_at = NOW()`
	if err := tx.Exec(profileSQL, newID, email, walletAddress, username).Error; err != nil {
		return user, fmt.Errorf("profile insert (id=%s): %w", newID, err)
	}

	// Load the created/updated profile
	if err := tx.Where("id = ?", newID).First(&user).Error; err != nil {
		return user, fmt.Errorf("profile load: %w", err)
	}

	// Create wallet only when missing (retries / email conflict can reuse an existing user_id).
	var existingWallet models.Wallet
	walletErr := tx.Where("user_id = ?", user.ID).First(&existingWallet).Error
	if walletErr != nil {
		if !errors.Is(walletErr, gorm.ErrRecordNotFound) {
			return user, fmt.Errorf("%w: lookup: %v", errAccountWallet, walletErr)
		}
		wallet := models.Wallet{
			UserID:     user.ID,
			BalanceSOL: 0,
		}
		wallet.InitializeWithDefaultLimits(models.TrustTierNew)
		if err := tx.Create(&wallet).Error; err != nil {
			return user, fmt.Errorf("%w: %v", errAccountWallet, err)
		}
	}
	return user, nil
}
