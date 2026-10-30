package models

import (
	"time"

	"github.com/google/uuid"
)

// PayoutDestination is where a managed-wallet provider receives cedis.
// The phone number is stored encrypted; only the last 4 digits are shown.
type PayoutDestination struct {
	ID            uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID        uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"user_id"`
	Type          string    `gorm:"not null;default:mobile_money" json:"type"`
	Network       string    `gorm:"not null" json:"network"` // MTN | VOD | ATL
	PhoneEnc      string    `gorm:"column:phone_enc;not null" json:"-"`
	PhoneLast4    string    `gorm:"column:phone_last4;not null" json:"phone_last4"`
	AccountName   string    `gorm:"not null" json:"account_name"`
	RecipientCode string    `gorm:"not null" json:"-"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (PayoutDestination) TableName() string { return "payout_destinations" }

// CashoutStatus is the forward-only state of a cash-out. See migration 000159.
type CashoutStatus string

const (
	CashoutQuoted       CashoutStatus = "quoted"
	CashoutConfirmed    CashoutStatus = "confirmed"
	CashoutSweeping     CashoutStatus = "sweeping"     // sweep tx signed and sent; signature recorded
	CashoutSwept        CashoutStatus = "swept"        // SOL is in the platform float
	CashoutTransferring CashoutStatus = "transferring" // Paystack transfer started
	CashoutCompleted    CashoutStatus = "completed"
	CashoutRefunding    CashoutStatus = "refunding" // transfer failed; sending SOL back
	CashoutRefunded     CashoutStatus = "refunded"
	CashoutExpired      CashoutStatus = "expired"
	CashoutFailed       CashoutStatus = "failed"
)

// CashoutOpenStatuses are the in-progress states (at most one per user).
var CashoutOpenStatuses = []CashoutStatus{CashoutConfirmed, CashoutSweeping, CashoutSwept, CashoutTransferring, CashoutRefunding}

// Cashout moves SOL from a managed wallet to the float and pays GHS to MoMo.
type Cashout struct {
	ID            uuid.UUID     `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID        uuid.UUID     `gorm:"type:uuid;not null;index" json:"user_id"`
	DestinationID uuid.UUID     `gorm:"type:uuid;not null" json:"destination_id"`
	Reference     string        `gorm:"not null;uniqueIndex" json:"reference"`
	Lamports      int64         `gorm:"not null" json:"lamports"`
	AmountMinor   int64         `gorm:"not null" json:"amount_minor"`
	FeeMinor      int64         `gorm:"not null;default:0" json:"fee_minor"`
	Currency      string        `gorm:"not null;default:GHS" json:"currency"`
	SOLPriceUSD   float64       `gorm:"column:sol_price_usd;type:numeric(20,6);not null" json:"sol_price_usd"`
	USDGHSRate    float64       `gorm:"column:usd_ghs_rate;type:numeric(20,6);not null" json:"usd_ghs_rate"`
	Status        CashoutStatus `gorm:"not null;default:quoted" json:"status"`
	SweepTx       string        `json:"sweep_tx,omitempty"`
	SweepSentAt   *time.Time    `json:"-"`
	TransferCode  string        `json:"-"`
	RefundTx      string        `json:"refund_tx,omitempty"`
	RefundStarted *time.Time    `gorm:"column:refund_started_at" json:"-"`
	Attempts      int           `gorm:"not null;default:0" json:"attempts"`
	LastError     string        `json:"last_error,omitempty"`
	CreatedAt     time.Time     `json:"created_at"`
	UpdatedAt     time.Time     `json:"updated_at"`
}

func (Cashout) TableName() string { return "cashouts" }
