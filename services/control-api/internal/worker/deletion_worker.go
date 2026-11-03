package worker

import (
	"context"
	"github.com/proxyhubb/control-api/internal/accountclosure"
	"gorm.io/gorm/clause"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// StartGDPRDeletionWorker runs a periodic job to purge accounts scheduled for deletion
func StartGDPRDeletionWorker() {
	log.Printf("[Worker] GDPR Deletion Worker started (Interval: 12h)")

	GoSupervised("GDPRDeletionWorker", 5*time.Second, func() {
		ticker := time.NewTicker(12 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			RunSafely("GDPRDeletionWorker.cycle", purgeExpiredAccounts)
		}
	})
}

func purgeExpiredAccounts() {
	if db.DB == nil {
		return
	}

	var users []models.User
	err := db.DB.Where("scheduled_deletion_at IS NOT NULL AND scheduled_deletion_at <= ?", time.Now()).Find(&users).Error
	if err != nil {
		log.Printf("[GDPRDeletionWorker] Failed to query expired accounts: %v", err)
		return
	}

	if len(users) == 0 {
		return
	}

	log.Printf("[GDPRDeletionWorker] Found %d account(s) expired and scheduled for deletion", len(users))

	for _, u := range users {
		if err := purgeUserAccount(u.ID, u.Email); err != nil {
			log.Printf("[GDPRDeletionWorker] Failed to purge user %s: %v", u.ID, err)
		}
	}
}

// purgeUserAccount removes user-owned rows across app tables, then profile and auth user.
func purgeUserAccount(userID uuid.UUID, email string) error {
	log.Printf("[GDPRDeletionWorker] Purging account %s", userID)

	return db.DB.Transaction(func(tx *gorm.DB) error {
		var locked models.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&locked, "id = ?", userID).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return nil
			}
			return err
		}
		if locked.ScheduledDeletionAt == nil || locked.ScheduledDeletionAt.After(time.Now()) {
			return nil
		}
		if err := accountclosure.Check(context.Background(), tx, userID, true); err != nil {
			return err
		}
		if err := tx.Exec("UPDATE audit_logs SET actor_email = '', ip_address = NULL, user_agent = NULL, metadata = '{}' WHERE actor_id = ?", userID).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&models.EmbeddedWallet{}).Error; err != nil {
			return err
		}
		for _, table := range []string{"auth_mfa_challenges", "refresh_token_families", "user_identities", "payout_destinations", "marketplace_funnel_events"} {
			if err := tx.Exec("DELETE FROM "+table+" WHERE user_id = ?", userID).Error; err != nil {
				return err
			}
		}
		// 000116 append-only guard: allow GDPR DELETE of ledger rows in this txn only.
		if err := tx.Exec("SELECT set_config('app.wallet_ledger_allow_mutate', 'gdpr_delete', true)").Error; err != nil {
			return err
		}

		var walletIDs []uuid.UUID
		if err := tx.Model(&models.Wallet{}).Where("user_id = ?", userID).Pluck("id", &walletIDs).Error; err != nil {
			return err
		}
		if len(walletIDs) > 0 {
			if err := tx.Where("wallet_id IN ?", walletIDs).Delete(&models.WalletLedgerEntry{}).Error; err != nil {
				return err
			}
			// Cold archive may hold historical rows for the same wallets.
			if err := tx.Table("wallet_ledger_entries_archive").
				Where("wallet_id IN ?", walletIDs).
				Delete(&models.WalletLedgerEntry{}).Error; err != nil {
				if !isUndefinedTable(err) {
					return err
				}
			}
		}

		if err := tx.Where("user_id = ?", userID).Delete(&models.Wallet{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&models.PendingTransaction{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&models.UserFlag{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&models.SecurityAnomaly{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&models.SpendingRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&models.UserSubscription{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&models.APIKey{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&models.Notification{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&models.UserSession{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&models.UserSettings{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&models.LinkedWallet{}).Error; err != nil {
			return err
		}
		if err := tx.Where("follower_id = ? OR following_id = ?", userID, userID).Delete(&models.Follow{}).Error; err != nil {
			return err
		}
		if err := tx.Where("blocker_id = ? OR blocked_id = ?", userID, userID).Delete(&models.Block{}).Error; err != nil {
			return err
		}

		// A failed statement aborts the whole transaction in PostgreSQL, so check it like
		// the rest. (A second DELETE from a legacy "listings" table that no migration
		// creates used to abort every purge here.)
		if err := tx.Exec("DELETE FROM proxy_listings WHERE seller_id = ?", userID).Error; err != nil {
			return err
		}

		if err := tx.Where("id = ?", userID).Delete(&models.User{}).Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM auth.users WHERE id = ?", userID).Error; err != nil {
			return err
		}

		log.Printf("[GDPRDeletionWorker] Successfully purged user ID %s", userID)
		return nil
	})
}

func isUndefinedTable(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "does not exist") || strings.Contains(msg, "undefined_table")
}
