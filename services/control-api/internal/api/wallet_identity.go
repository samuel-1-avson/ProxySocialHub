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

// ErrWalletLinkedElsewhere: the proven address already belongs to a
// different account (P2 \u00a79 sentinel; was string-matched at 3 sites).
var ErrWalletLinkedElsewhere = fmt.Errorf("wallet already linked to another account")

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
			return ErrWalletLinkedElsewhere
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

// applyWithdrawalRoutingForSolana maintains wallets.primary_withdrawal_address
// and the 24h cooldown anchor for a proven-primary Solana
// address. Semantics preserved from the historical /wallet/link handler:
// first primary and every change set changed_at=now (cooldown applies);
// re-asserting the same address is a no-op.
func applyWithdrawalRoutingForSolana(tx *gorm.DB, user models.User, address string) error {
	var wallet models.Wallet
	if err := tx.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			now := time.Now()
			wallet = models.Wallet{
				UserID:                     user.ID,
				PrimaryWithdrawalAddress:   &address,
				WithdrawalAddressChangedAt: &now,
			}
			wallet.InitializeWithDefaultLimits(user.TrustTier)
			return tx.Create(&wallet).Error
		}
		return err
	}

	if wallet.PrimaryWithdrawalAddress != nil && *wallet.PrimaryWithdrawalAddress == address {
		return nil
	}
	now := time.Now()
	wallet.PrimaryWithdrawalAddress = &address
	wallet.WithdrawalAddressChangedAt = &now
	// W-34: withdrawal_whitelist no longer maintained (removed feature).
	return tx.Save(&wallet).Error
}

// applySolanaLinkIdentity is the ONE code path that establishes a proven
// primary Solana identity (P0-4): profiles.wallet_address +
// linked_wallets primary row + withdrawal routing/cooldown, atomically in
// the caller's transaction. Every entry point (/wallet/link,
// /linked-wallets, set-primary, wallet login) goes through here so the
// cooldown can never be bypassed by choosing a different endpoint.
func applySolanaLinkIdentity(tx *gorm.DB, user models.User, address string, sig, msg *string) error {
	address = strings.TrimSpace(address)
	if err := setProfileWalletAddress(tx, user.ID, &address); err != nil {
		return err
	}
	if err := ensurePrimaryLinkedSolana(tx, user.ID, address, sig, msg); err != nil {
		return err
	}
	return applyWithdrawalRoutingForSolana(tx, user, address)
}

// applyEthereumLinkIdentity upserts a verified Ethereum linked_wallets row
// (P0-4, W-05). It NEVER touches profiles.wallet_address (the Solana
// identity) or withdrawal routing.
func applyEthereumLinkIdentity(tx *gorm.DB, userID uuid.UUID, address string, sig, msg *string) error {
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
	err := tx.Where("chain = ? AND address = ?", models.ChainEthereum, address).First(&byAddress).Error
	if err == nil {
		if byAddress.UserID != userID {
			return ErrWalletLinkedElsewhere
		}
		if err := tx.Model(&models.LinkedWallet{}).
			Where("user_id = ? AND chain = ? AND id != ?", userID, models.ChainEthereum, byAddress.ID).
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

	if err := tx.Model(&models.LinkedWallet{}).
		Where("user_id = ? AND chain = ?", userID, models.ChainEthereum).
		Update("is_primary", false).Error; err != nil {
		return err
	}
	label := "Primary"
	row := models.LinkedWallet{
		ID:                    uuid.New(),
		UserID:                userID,
		Chain:                 models.ChainEthereum,
		Address:               address,
		Verified:              true,
		VerificationSignature: sig,
		VerificationMessage:   msg,
		IsPrimary:             true,
		Label:                 &label,
		CreatedAt:             now,
		UpdatedAt:             now,
	}
	return tx.Create(&row).Error
}
