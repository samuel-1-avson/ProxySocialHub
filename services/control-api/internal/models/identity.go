package models

import (
	"time"

	"github.com/google/uuid"
)

// IdentityProviderGoogle is the user_identities.provider value for Google sign-in.
const IdentityProviderGoogle = "google"

// UserIdentity maps an external login identity (e.g. Google `sub`) to a profile.
// Accounts are found by (provider, subject), never by email.
type UserIdentity struct {
	ID          uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	Provider    string     `gorm:"not null;uniqueIndex:user_identities_provider_subject_key" json:"provider"`
	Subject     string     `gorm:"not null;uniqueIndex:user_identities_provider_subject_key" json:"-"`
	EmailHash   string     `json:"-"`
	CreatedAt   time.Time  `json:"created_at"`
	LastLoginAt *time.Time `json:"last_login_at,omitempty"`
}

func (UserIdentity) TableName() string { return "user_identities" }

// EmbeddedWallet is a Solana wallet the server created and holds for a user who
// signed in without a crypto wallet. SealedKey and WrappedDEK are ciphertext
// (see internal/custody) and must never be serialized.
type EmbeddedWallet struct {
	ID         uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID     uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"user_id"`
	Chain      string    `gorm:"not null;default:solana" json:"chain"`
	Address    string    `gorm:"not null;uniqueIndex" json:"address"`
	SealedKey  []byte    `gorm:"not null" json:"-"`
	WrappedDEK []byte    `gorm:"column:wrapped_dek;not null" json:"-"`
	KEKID      string    `gorm:"column:kek_id;not null" json:"-"`
	CreatedAt  time.Time `json:"created_at"`
}

func (EmbeddedWallet) TableName() string { return "embedded_wallets" }
