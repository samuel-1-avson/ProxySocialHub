package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

type UserStatus string

const (
	UserStatusActive    UserStatus = "active"
	UserStatusPending   UserStatus = "pending"
	UserStatusSuspended UserStatus = "suspended"
	UserStatusBanned    UserStatus = "banned"
)

type KYCStatus string

const (
	KYCStatusNone              KYCStatus = "none"
	KYCStatusPending           KYCStatus = "pending"
	KYCStatusApproved          KYCStatus = "approved"
	KYCStatusRejected          KYCStatus = "rejected"
	KYCStatusInsufficientFunds KYCStatus = "insufficient_funds"
)

// KYCStatusUnset reports whether KYC has not been started (empty or none).
func KYCStatusUnset(s KYCStatus) bool {
	return s == "" || s == KYCStatusNone
}

type TrustTier string

const (
	TrustTierNew      TrustTier = "new"
	TrustTierVerified TrustTier = "verified"
	TrustTierPremium  TrustTier = "premium"
)

// User maps to the 'profiles' table in Supabase
type User struct {
	ID        uuid.UUID  `gorm:"type:uuid;primary_key" json:"id"` // References auth.users
	Email     string     `gorm:"unique" json:"email"`             // nullable stub after vault cutover
	EmailHash *string    `gorm:"column:email_hash;size:64" json:"-"`
	Role      string     `gorm:"not null" json:"role"` // 'buyer', 'provider', 'admin'
	Status    UserStatus `gorm:"type:varchar(50);default:'active'" json:"status"`
	TrustTier TrustTier  `gorm:"default:'new'" json:"trust_tier"`
	KYCStatus KYCStatus  `gorm:"type:varchar(50);default:'none'" json:"kyc_status"`

	// Social Profile fields
	DisplayName   *string        `gorm:"size:100" json:"display_name,omitempty"`
	Username      *string        `gorm:"size:50;unique" json:"username,omitempty"`
	Bio           *string        `json:"bio,omitempty"`
	AvatarURL     *string        `json:"avatar_url,omitempty"`
	CoverImageURL *string        `json:"cover_image_url,omitempty"`
	Location      *string        `gorm:"size:100" json:"location,omitempty"`
	ISP           *string        `gorm:"size:100" json:"isp,omitempty"`
	Website       *string        `gorm:"size:255" json:"website,omitempty"`
	SocialLinks   JSONMap        `gorm:"type:jsonb" json:"social_links,omitempty"` // {"twitter": "...", "github": "..."}
	Skills        pq.StringArray `gorm:"type:text[]" json:"skills,omitempty"`

	// Professional Identity
	ProfessionalTitle     *string        `gorm:"size:100" json:"professional_title,omitempty"`
	ExperienceYears       int            `gorm:"default:0" json:"experience_years"`
	Languages             pq.StringArray `gorm:"type:text[]" json:"languages,omitempty"`
	PrimarySpecialization *string        `gorm:"size:100" json:"primary_specialization,omitempty"`

	// Business Profile
	BusinessName *string `gorm:"size:100" json:"business_name,omitempty"`
	TaxID        *string `gorm:"type:text" json:"tax_id,omitempty"` // ENC: ciphertext at rest (PII-01)

	// Social Stats
	FollowersCount int     `gorm:"default:0" json:"followers_count"`
	FollowingCount int     `gorm:"default:0" json:"following_count"`
	ReviewsCount   int     `gorm:"default:0" json:"reviews_count"`
	AvgRating      float64 `gorm:"default:0" json:"avg_rating"`
	Verified       bool    `gorm:"default:false" json:"verified"`

	// Provider Stats
	ProviderSince      *time.Time `json:"provider_since,omitempty"`
	TotalBandwidthSold float64    `gorm:"default:0" json:"total_bandwidth_sold"`
	WalletAddress      *string    `gorm:"size:64;index" json:"wallet_address,omitempty"` // Solana wallet address (base58)

	// Auth / Verification
	VerificationToken *string `gorm:"size:255" json:"-"`
	EmailVerified     bool    `gorm:"default:false" json:"email_verified"`

	// Online presence
	IsOnline               bool       `gorm:"default:false;index:idx_user_online" json:"is_online"`
	LastSeenAt             *time.Time `json:"last_seen_at,omitempty"`
	ScheduledDeletionAt    *time.Time `gorm:"index" json:"scheduled_deletion_at,omitempty"`
	ProfilePublic          bool       `json:"-"`
	Discoverable           bool       `json:"-"`
	MapVisible             bool       `json:"-"`
	MapPrecision           string     `gorm:"default:'country'" json:"-"`
	PresenceVisible        bool       `json:"-"`
	ActivityPublic         bool       `json:"-"`
	ContactMode            string     `gorm:"default:'contacts'" json:"-"`
	AnalyticsOptIn         bool       `json:"-"`
	AllowDirectConnections bool       `json:"-"`
	PublicChainConsent     bool       `json:"-"`
	PrivacyUpdatedAt       *time.Time `json:"-"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// JSONMap for generic JSON DB storage
type JSONMap map[string]interface{}

// Scan implements sql.Scanner
func (j *JSONMap) Scan(value interface{}) error {
	if value == nil {
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return errors.New("type assertion to []byte failed")
	}
	return json.Unmarshal(bytes, &j)
}

// Value implements driver.Valuer
func (j JSONMap) Value() (driver.Value, error) {
	if j == nil {
		return nil, nil
	}
	return json.Marshal(j)
}

// TableName overrides the table name used by User to `profiles`
func (User) TableName() string {
	return "profiles"
}

func (u *User) BeforeCreate(tx *gorm.DB) (err error) {
	// ID is provided by Supabase Auth (auth.users), so we don't generate it here usually.
	// But if the trigger creates it, this code might not even run for the initial creation?
	// The Go code might read/update it.
	if u.TrustTier == "" {
		u.TrustTier = TrustTierNew
	}
	if u.Status == "" {
		u.Status = UserStatusActive
	}
	if err := u.syncEmailHashAndVault(tx); err != nil {
		return err
	}
	return u.encryptTaxID()
}

func (u *User) BeforeSave(tx *gorm.DB) error {
	if err := u.syncEmailHashAndVault(tx); err != nil {
		return err
	}
	return u.encryptTaxID()
}

func (u *User) AfterFind(tx *gorm.DB) error {
	if err := LoadProfilePrivateDecrypt(tx, u); err != nil {
		return err
	}
	return u.decryptTaxID()
}

// syncEmailHashAndVault writes email_hash + vault when plaintext email/tax present,
// and clears profiles.email/tax_id once vault encryption is available.
func (u *User) syncEmailHashAndVault(tx *gorm.DB) error {
	if u.ID == uuid.Nil {
		return nil
	}
	if CredentialEncryptFn == nil || EmailHashFn == nil {
		return nil
	}
	hasEmail := u.Email != ""
	hasTax := u.TaxID != nil && *u.TaxID != ""
	if !hasEmail && !hasTax {
		return nil
	}
	var emailPtr *string
	if hasEmail {
		e := NormalizeEmail(u.Email)
		emailPtr = &e
		h := HashEmail(e)
		u.EmailHash = &h
	}
	var taxPtr *string
	if hasTax {
		taxPtr = u.TaxID
	}
	wrote, err := UpsertProfilePrivate(tx, u.ID, emailPtr, taxPtr)
	if err != nil {
		return err
	}
	if !wrote {
		return nil
	}
	// Persist NULL plaintext columns (empty string would violate unique email).
	if hasEmail {
		tx.Statement.SetColumn("email", nil)
		tx.Statement.SetColumn("email_hash", u.EmailHash)
	}
	if hasTax {
		tx.Statement.SetColumn("tax_id", nil)
	}
	return nil
}

func (u *User) encryptTaxID() error {
	if CredentialEncryptFn == nil || u.TaxID == nil || *u.TaxID == "" {
		return nil
	}
	if isEncryptedField(*u.TaxID) {
		return nil
	}
	enc, err := encryptField(*u.TaxID)
	if err != nil {
		return err
	}
	u.TaxID = &enc
	return nil
}

func (u *User) decryptTaxID() error {
	if CredentialDecryptFn == nil || u.TaxID == nil || *u.TaxID == "" {
		return nil
	}
	if !isEncryptedField(*u.TaxID) {
		return nil
	}
	plain, err := decryptField(*u.TaxID)
	if err != nil {
		empty := ""
		u.TaxID = &empty
		return nil
	}
	u.TaxID = &plain
	return nil
}

// MigratePlaintextTaxIDs encrypts any profiles.tax_id values that lack the ENC: prefix.
// Gate with MIGRATE_TAX_IDS=true (same pattern as MIGRATE_CREDENTIALS).
func MigratePlaintextTaxIDs(db *gorm.DB) (migrated int, errs []error) {
	if CredentialEncryptFn == nil {
		return 0, []error{errors.New("tax_id migration: encryption not configured")}
	}
	var rows []User
	if err := db.Where("tax_id IS NOT NULL AND tax_id <> '' AND tax_id NOT LIKE 'ENC:%'").Find(&rows).Error; err != nil {
		return 0, []error{err}
	}
	for i := range rows {
		u := &rows[i]
		if err := u.encryptTaxID(); err != nil {
			errs = append(errs, err)
			continue
		}
		if err := db.Model(u).Update("tax_id", u.TaxID).Error; err != nil {
			errs = append(errs, err)
			continue
		}
		migrated++
	}
	return migrated, errs
}

// AdminUserView is a safe admin serialization of profiles (no verification token;
// tax_id presence only, never plaintext ciphertext dump).
type AdminUserView struct {
	ID            uuid.UUID  `json:"id"`
	Email         string     `json:"email"`
	Role          string     `json:"role"`
	Status        UserStatus `json:"status"`
	TrustTier     TrustTier  `json:"trust_tier"`
	KYCStatus     KYCStatus  `json:"kyc_status"`
	DisplayName   *string    `json:"display_name,omitempty"`
	Username      *string    `json:"username,omitempty"`
	BusinessName  *string    `json:"business_name,omitempty"`
	HasTaxID      bool       `json:"has_tax_id"`
	EmailVerified bool       `json:"email_verified"`
	Verified      bool       `json:"verified"`
	WalletAddress *string    `json:"wallet_address,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

func (u User) ToAdminView() AdminUserView {
	return AdminUserView{
		ID:            u.ID,
		Email:         u.Email,
		Role:          u.Role,
		Status:        u.Status,
		TrustTier:     u.TrustTier,
		KYCStatus:     u.KYCStatus,
		DisplayName:   u.DisplayName,
		Username:      u.Username,
		BusinessName:  u.BusinessName,
		HasTaxID:      u.TaxID != nil && *u.TaxID != "",
		EmailVerified: u.EmailVerified,
		Verified:      u.Verified,
		WalletAddress: u.WalletAddress,
		CreatedAt:     u.CreatedAt,
		UpdatedAt:     u.UpdatedAt,
	}
}

// IsActive returns true only when the user's status is active or pending.
// Banned and suspended users are rejected by auth middleware.
func (u *User) IsActive() bool {
	return u.Status != UserStatusBanned && u.Status != UserStatusSuspended
}

// TierConfig holds the rate limits for each trust tier
type TierConfig struct {
	Tier              TrustTier
	RequestsPerMinute int
	MaxBandwidthGB    float64 // -1 for unlimited
	MaxConcurrency    int
	AllowAutomation   bool
}

// GetTierConfig returns the configuration for a given trust tier
func GetTierConfig(tier TrustTier) TierConfig {
	switch tier {
	case TrustTierVerified:
		return TierConfig{
			Tier:              TrustTierVerified,
			RequestsPerMinute: 100,
			MaxBandwidthGB:    50,
			MaxConcurrency:    10,
			AllowAutomation:   true,
		}
	case TrustTierPremium:
		return TierConfig{
			Tier:              TrustTierPremium,
			RequestsPerMinute: 1000,
			MaxBandwidthGB:    -1, // Unlimited
			MaxConcurrency:    100,
			AllowAutomation:   true,
		}
	default: // TrustTierNew
		return TierConfig{
			Tier:              TrustTierNew,
			RequestsPerMinute: 10,
			MaxBandwidthGB:    5,
			MaxConcurrency:    3,
			AllowAutomation:   false,
		}
	}
}
