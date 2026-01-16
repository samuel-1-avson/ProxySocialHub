package models

import (
	"database/sql/driver"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type KYCStatus string

const (
	KYCStatusNotStarted   KYCStatus = "not_started"
	KYCStatusPending      KYCStatus = "pending"
	KYCStatusInReview     KYCStatus = "in_review"
	KYCStatusApproved     KYCStatus = "approved"
	KYCStatusRejected     KYCStatus = "rejected"
	KYCStatusExpired      KYCStatus = "expired"
)

type KYCProvider string

const (
	KYCProviderManual  KYCProvider = "manual"
	KYCProviderSumSub  KYCProvider = "sumsub"
	KYCProviderSmileID KYCProvider = "smile_id"
)

type DocumentType string

const (
	DocumentIDCard       DocumentType = "id_card"
	DocumentPassport     DocumentType = "passport"
	DocumentDriverLicense DocumentType = "driver_license"
	DocumentVoterID      DocumentType = "voter_id"
	DocumentGhanaCard    DocumentType = "ghana_card"
)

// KYCData represents the structured data from KYC verification
type KYCData struct {
	FirstName       string       `json:"first_name,omitempty"`
	LastName        string       `json:"last_name,omitempty"`
	DateOfBirth     string       `json:"date_of_birth,omitempty"`
	DocumentType    DocumentType `json:"document_type,omitempty"`
	DocumentNumber  string       `json:"document_number,omitempty"`
	DocumentExpiry  string       `json:"document_expiry,omitempty"`
	Country         string       `json:"country,omitempty"`
	PhoneNumber     string       `json:"phone_number,omitempty"`
	Address         string       `json:"address,omitempty"`
	VerificationURL string       `json:"verification_url,omitempty"`
	RejectionReason string       `json:"rejection_reason,omitempty"`
}

// Value implements driver.Valuer for GORM JSONB storage
func (d KYCData) Value() (driver.Value, error) {
	return json.Marshal(d)
}

// Scan implements sql.Scanner for GORM JSONB retrieval
func (d *KYCData) Scan(value interface{}) error {
	if value == nil {
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return nil
	}
	return json.Unmarshal(bytes, d)
}

// KycVerification represents a KYC verification record
type KycVerification struct {
	ID           uuid.UUID   `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID       uuid.UUID   `gorm:"type:uuid;not null;index" json:"user_id"`
	Status       KYCStatus   `gorm:"type:varchar(50);default:'not_started'" json:"status"`
	Provider     KYCProvider `gorm:"type:varchar(50)" json:"provider"`
	ReferenceID  string      `gorm:"type:varchar(255)" json:"reference_id,omitempty"`
	ApplicantID  string      `gorm:"type:varchar(255)" json:"applicant_id,omitempty"`
	Data         KYCData     `gorm:"type:jsonb" json:"data"`
	SubmittedAt  *time.Time  `json:"submitted_at,omitempty"`
	ReviewedAt   *time.Time  `json:"reviewed_at,omitempty"`
	ReviewedBy   string      `json:"reviewed_by,omitempty"`
	CreatedAt    time.Time   `json:"created_at"`
	UpdatedAt    time.Time   `json:"updated_at"`
}

func (k *KycVerification) BeforeCreate(tx *gorm.DB) (err error) {
	if k.ID == uuid.Nil {
		k.ID = uuid.New()
	}
	if k.Status == "" {
		k.Status = KYCStatusNotStarted
	}
	return
}

// IsVerified returns true if the user has passed KYC
func (k *KycVerification) IsVerified() bool {
	return k.Status == KYCStatusApproved
}

// IsPending returns true if KYC is in progress
func (k *KycVerification) IsPending() bool {
	return k.Status == KYCStatusPending || k.Status == KYCStatusInReview
}
