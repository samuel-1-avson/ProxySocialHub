package models

import (
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ProfilePrivate holds encrypted PII off the public profiles row (Phase D).
type ProfilePrivate struct {
	UserID    uuid.UUID `gorm:"type:uuid;primaryKey" json:"user_id"`
	EmailEnc  *string   `gorm:"column:email_enc;type:text" json:"-"`
	TaxIDEnc  *string   `gorm:"column:tax_id_enc;type:text" json:"-"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ProfilePrivate) TableName() string { return "profile_private" }

// EmailHashFn HMAC-hashes normalized emails for profiles.email_hash lookups.
// Wired from main via crypto.NewEmailHashFn(EMAIL_HASH_PEPPER).
var EmailHashFn func(email string) string

// NormalizeEmail lowercases and trims for hashing / vault storage.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// HashEmail returns HMAC hex for lookup, or empty if hasher unset / email empty.
func HashEmail(email string) string {
	n := NormalizeEmail(email)
	if n == "" || EmailHashFn == nil {
		return ""
	}
	return EmailHashFn(n)
}

// UpsertProfilePrivate writes encrypted email/tax_id into the vault.
// Returns wrote=false when profile_private is not migrated yet.
func UpsertProfilePrivate(tx *gorm.DB, userID uuid.UUID, plainEmail, plainTaxID *string) (wrote bool, err error) {
	if CredentialEncryptFn == nil {
		return false, errors.New("profile vault: encryption not configured")
	}
	var n int64
	if err := tx.Raw(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='profile_private'`).Scan(&n).Error; err != nil || n == 0 {
		return false, nil // pre-000125
	}
	row := ProfilePrivate{UserID: userID, UpdatedAt: time.Now().UTC()}
	_ = tx.Where("user_id = ?", userID).First(&row).Error

	if plainEmail != nil && *plainEmail != "" {
		enc, encErr := encryptField(NormalizeEmail(*plainEmail))
		if encErr != nil {
			return false, encErr
		}
		row.EmailEnc = &enc
	}
	if plainTaxID != nil {
		if *plainTaxID == "" {
			row.TaxIDEnc = nil
		} else if isEncryptedField(*plainTaxID) {
			row.TaxIDEnc = plainTaxID
		} else {
			enc, encErr := encryptField(*plainTaxID)
			if encErr != nil {
				return false, encErr
			}
			row.TaxIDEnc = &enc
		}
	}
	row.UpdatedAt = time.Now().UTC()
	if err := tx.Save(&row).Error; err != nil {
		return false, err
	}
	return true, nil
}

// LoadProfilePrivateDecrypt fills user.Email / user.TaxID from vault when present.
func LoadProfilePrivateDecrypt(tx *gorm.DB, u *User) error {
	if u == nil || u.ID == uuid.Nil {
		return nil
	}
	var row ProfilePrivate
	if err := tx.Where("user_id = ?", u.ID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if row.EmailEnc != nil && *row.EmailEnc != "" && CredentialDecryptFn != nil {
		plain, err := decryptField(*row.EmailEnc)
		if err == nil && plain != "" {
			u.Email = plain
		}
	}
	if row.TaxIDEnc != nil && *row.TaxIDEnc != "" {
		if CredentialDecryptFn != nil && isEncryptedField(*row.TaxIDEnc) {
			plain, err := decryptField(*row.TaxIDEnc)
			if err == nil {
				u.TaxID = &plain
			}
		} else {
			u.TaxID = row.TaxIDEnc
		}
	}
	return nil
}

// MigrateEmailsToVault moves plaintext profiles.email (+ tax_id ciphertext) into
// profile_private, backfills email_hash, then nulls plaintext columns.
// Gate with MIGRATE_EMAILS=true.
func MigrateEmailsToVault(db *gorm.DB) (migrated int, errs []error) {
	if CredentialEncryptFn == nil {
		return 0, []error{errors.New("email vault migration: encryption not configured")}
	}
	if EmailHashFn == nil {
		return 0, []error{errors.New("email vault migration: EMAIL_HASH_PEPPER / hasher not configured")}
	}

	var rows []User
	if err := db.Where("email IS NOT NULL AND email <> ''").Find(&rows).Error; err != nil {
		return 0, []error{err}
	}
	for i := range rows {
		u := &rows[i]
		email := u.Email
		tax := u.TaxID
		if _, err := UpsertProfilePrivate(db, u.ID, &email, tax); err != nil {
			errs = append(errs, err)
			continue
		}
		hash := HashEmail(email)
		updates := map[string]interface{}{
			"email_hash": hash,
			"email":      nil,
			"tax_id":     nil,
		}
		if err := db.Model(&User{}).Where("id = ?", u.ID).Updates(updates).Error; err != nil {
			errs = append(errs, err)
			continue
		}
		migrated++
	}

	// Move remaining tax_id ciphertext with no email left.
	var taxOnly []User
	if err := db.Where("tax_id IS NOT NULL AND tax_id <> ''").Find(&taxOnly).Error; err != nil {
		errs = append(errs, err)
		return migrated, errs
	}
	for i := range taxOnly {
		u := &taxOnly[i]
		if _, err := UpsertProfilePrivate(db, u.ID, nil, u.TaxID); err != nil {
			errs = append(errs, err)
			continue
		}
		if err := db.Model(&User{}).Where("id = ?", u.ID).Update("tax_id", nil).Error; err != nil {
			errs = append(errs, err)
			continue
		}
		migrated++
	}

	return migrated, errs
}
