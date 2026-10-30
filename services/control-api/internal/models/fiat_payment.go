package models

import (
	"time"

	"github.com/google/uuid"
)

// FiatPaymentStatus is the forward-only state of a fiat payment.
type FiatPaymentStatus string

const (
	FiatPaymentQuoted   FiatPaymentStatus = "quoted"   // Paystack transaction created, not paid
	FiatPaymentPaid     FiatPaymentStatus = "paid"     // Paystack verified the charge
	FiatPaymentFunded   FiatPaymentStatus = "funded"   // treasury sent SOL to the managed wallet
	FiatPaymentEscrowed FiatPaymentStatus = "escrowed" // managed wallet funded the on-chain escrow
	FiatPaymentActive   FiatPaymentStatus = "active"   // order active, credentials available
	FiatPaymentFailed   FiatPaymentStatus = "failed"
	FiatPaymentRefunded FiatPaymentStatus = "refunded"
)

// FiatPayment is one Paystack quote/charge for a marketplace order paid by a
// managed-wallet buyer. See migrations/000172_fiat_payments.up.sql.
type FiatPayment struct {
	ID             uuid.UUID         `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	OrderID        uuid.UUID         `gorm:"type:uuid;not null;index" json:"order_id"`
	UserID         uuid.UUID         `gorm:"type:uuid;not null" json:"user_id"`
	Provider       string            `gorm:"not null;default:paystack" json:"provider"`
	Reference      string            `gorm:"not null;uniqueIndex" json:"reference"`
	AccessCode     string            `json:"-"`
	AmountMinor    int64             `gorm:"not null" json:"amount_minor"`
	Currency       string            `gorm:"not null;default:GHS" json:"currency"`
	USDAmount      float64           `gorm:"column:usd_amount;type:numeric(20,6);not null" json:"usd_amount"`
	USDGHSRate     float64           `gorm:"column:usd_ghs_rate;type:numeric(20,6);not null" json:"usd_ghs_rate"`
	SOLPriceUSD    float64           `gorm:"column:sol_price_usd;type:numeric(20,6);not null" json:"sol_price_usd"`
	LamportsNeeded int64             `gorm:"not null" json:"lamports_needed"`
	LamportsFunded int64             `gorm:"not null;default:0" json:"lamports_funded"`
	Status         FiatPaymentStatus `gorm:"not null;default:quoted" json:"status"`
	ProviderTxID   *int64            `json:"-"`
	FundingTx      string            `json:"funding_tx,omitempty"`
	FundingSentAt  *time.Time        `json:"-"`
	EscrowTx       string            `json:"escrow_tx,omitempty"`
	Attempts       int               `gorm:"not null;default:0" json:"attempts"`
	LastError      string            `json:"last_error,omitempty"`
	CreatedAt      time.Time         `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`
}

func (FiatPayment) TableName() string { return "fiat_payments" }
