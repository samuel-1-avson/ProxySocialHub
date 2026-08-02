package api

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// ensurePrimaryLinkedSolana upserts a verified primary Solana row in linked_wallets.
// Wallet login and /v1/wallet/link historically only wrote profiles.wallet_address;
// marketplace escrow requires linked_wallets.is_primary. Call this whenever the
// profile Solana identity is established with proven ownership.
//
// sig/msg may be nil when ownership was proven via wallet-login challenge.
func ensurePrimaryLinkedSolana(tx *gorm.DB, userID uuid.UUID, address string, sig, msg *string) error {
	if tx == nil {
		return fmt.Errorf("nil db")
	}
	address = strings.TrimSpace(address)
	if address == "" || userID == uuid.Nil {
		return nil
	}
	if !tx.Migrator().HasTable(&models.LinkedWallet{}) {
		return nil
	}

	now := time.Now().UTC()

	var byAddress models.LinkedWallet
	err := tx.Where("chain = ? AND address = ?", models.ChainSolana, address).First(&byAddress).Error
	if err == nil {
		if byAddress.UserID != userID {
			return fmt.Errorf("wallet already linked to another account")
		}
		// Clear other primaries for this user+chain, then promote this row.
		if err := tx.Model(&models.LinkedWallet{}).
			Where("user_id = ? AND chain = ? AND id != ?", userID, models.ChainSolana, byAddress.ID).
			Update("is_primary", false).Error; err != nil {
			return err
		}
		updates := map[string]interface{}{
			"verified":   true,
			"is_primary": true,
			"updated_at": now,
		}
		if sig != nil && strings.TrimSpace(*sig) != "" {
			updates["verification_signature"] = *sig
		}
		if msg != nil && strings.TrimSpace(*msg) != "" {
			updates["verification_message"] = *msg
		}
		return tx.Model(&byAddress).Updates(updates).Error
	}
	if err != gorm.ErrRecordNotFound {
		return err
	}

	// No row for this address — clear other primaries, then create.
	if err := tx.Model(&models.LinkedWallet{}).
		Where("user_id = ? AND chain = ?", userID, models.ChainSolana).
		Update("is_primary", false).Error; err != nil {
		return err
	}

	label := "Primary"
	row := models.LinkedWallet{
		ID:                    uuid.New(),
		UserID:                userID,
		Chain:                 models.ChainSolana,
		Address:               address,
		Verified:              true,
		VerificationSignature: sig,
		VerificationMessage:   msg,
		IsPrimary:             true,
		Label:                 &label,
		CreatedAt:             now,
		UpdatedAt:             now,
	}
	if err := tx.Create(&row).Error; err != nil {
		return err
	}
	logging.Info().
		Str("user_id", userID.String()).
		Str("address", address).
		Msg("ensured primary linked_wallets Solana row")
	return nil
}
