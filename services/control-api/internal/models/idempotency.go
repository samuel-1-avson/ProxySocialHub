package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Idempotency endpoints (stable strings stored in idempotency_records.endpoint).
const (
	IdempotencyEndpointWalletTransfer = "wallet_transfer"
	IdempotencyEndpointWalletWithdraw = "wallet_withdraw_sol"
	IdempotencyEndpointEarningsClaim  = "provider_earnings_claim"
	IdempotencyEndpointAdminPayout    = "admin_process_payout"
)

// IdempotencyRecord is a durable client Idempotency-Key claim (P0-9).
// The row is created inside the money transaction; ResponseBody is filled in
// once the handler knows its terminal response so retries replay it verbatim.
type IdempotencyRecord struct {
	ID             uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	UserID         uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_idem_user_endpoint_key,priority:1" json:"user_id"`
	Endpoint       string    `gorm:"type:varchar(64);not null;uniqueIndex:idx_idem_user_endpoint_key,priority:2" json:"endpoint"`
	IdempotencyKey string    `gorm:"type:varchar(128);not null;uniqueIndex:idx_idem_user_endpoint_key,priority:3" json:"idempotency_key"`
	Reference      string    `gorm:"type:varchar(128)" json:"reference,omitempty"`
	ResponseStatus int       `gorm:"not null;default:0" json:"response_status"`
	ResponseBody   string    `gorm:"type:text" json:"-"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

func (IdempotencyRecord) TableName() string { return "idempotency_records" }

func (r *IdempotencyRecord) BeforeCreate(tx *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}
