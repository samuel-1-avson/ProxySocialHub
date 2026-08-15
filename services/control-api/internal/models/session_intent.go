package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

type SessionIntentLifecycle string

const (
	SessionIntentAuthorized      SessionIntentLifecycle = "authorized"
	SessionIntentRouted          SessionIntentLifecycle = "routed"
	SessionIntentActive          SessionIntentLifecycle = "active"
	SessionIntentClosing         SessionIntentLifecycle = "closing"
	SessionIntentLedgerCommitted SessionIntentLifecycle = "ledger_committed"
	SessionIntentBatched         SessionIntentLifecycle = "batched"
	SessionIntentChainCommitted  SessionIntentLifecycle = "chain_committed"
	SessionIntentArchived        SessionIntentLifecycle = "archived"
	SessionIntentExpired         SessionIntentLifecycle = "expired"
)

func (s SessionIntentLifecycle) IsPreActivation() bool {
	switch s {
	case SessionIntentAuthorized, SessionIntentRouted:
		return true
	default:
		return false
	}
}

func (s SessionIntentLifecycle) IsTerminal() bool {
	switch s {
	case SessionIntentArchived, SessionIntentExpired:
		return true
	default:
		return false
	}
}

type SessionIntentRecord struct {
	ID                      uuid.UUID              `gorm:"type:uuid;primary_key" json:"id"`
	UserID                  uuid.UUID              `gorm:"type:uuid;not null;index:idx_session_intent_user" json:"user_id"`
	ListingID               *uuid.UUID             `gorm:"type:uuid;index:idx_session_intent_listing" json:"listing_id,omitempty"`
	SessionType             SessionType            `gorm:"type:varchar(50);not null" json:"session_type"`
	LifecycleState          SessionIntentLifecycle `gorm:"type:varchar(20);not null;default:'authorized';index:idx_session_intent_state" json:"lifecycle_state"`
	TrustTier               string                 `gorm:"type:varchar(50)" json:"trust_tier"`
	BandwidthLimit          int64                  `gorm:"default:0" json:"bandwidth_limit"`
	TargetGeo               string                 `gorm:"type:varchar(16)" json:"target_geo,omitempty"`
	TargetISP               string                 `gorm:"type:varchar(120)" json:"target_isp,omitempty"`
	RoutingProfile          string                 `gorm:"type:varchar(120)" json:"routing_profile,omitempty"`
	AllowedDomains          pq.StringArray         `gorm:"type:text[]" json:"allowed_domains"`
	BlockedDomains          pq.StringArray         `gorm:"type:text[]" json:"blocked_domains"`
	RotationType            string                 `gorm:"type:varchar(32)" json:"rotation_type,omitempty"`
	RotationIntervalSeconds int                    `gorm:"default:0" json:"rotation_interval_seconds"`
	TimeLimitMinutes        int                    `gorm:"default:0" json:"time_limit_minutes"`
	PreferredTier           string                 `gorm:"type:varchar(50)" json:"preferred_tier,omitempty"`
	RequestsPerMinute       int                    `gorm:"default:0" json:"requests_per_minute"`
	MaxConcurrency          int                    `gorm:"default:0" json:"max_concurrency"`
	MaxPricePerGB           float64                `gorm:"default:0" json:"max_price_per_gb"`
	BillingPricePerGBUSD    float64                `gorm:"column:billing_price_per_gb_usd;default:0" json:"billing_price_per_gb_usd"`
	BillingPriceSource      string                 `gorm:"type:varchar(32);default:'unknown'" json:"billing_price_source"`
	ProviderNodeID          string                 `gorm:"type:varchar(120);index:idx_session_intent_provider_node" json:"provider_node_id,omitempty"`
	TargetHost              string                 `gorm:"type:varchar(255)" json:"target_host,omitempty"`
	TotalBytesUp            int64                  `gorm:"default:0" json:"total_bytes_up"`
	TotalBytesDown          int64                  `gorm:"default:0" json:"total_bytes_down"`
	LastBytesUpDelta        int64                  `gorm:"default:0" json:"last_bytes_up_delta"`
	LastBytesDownDelta      int64                  `gorm:"default:0" json:"last_bytes_down_delta"`
	UsageUpdateCount        int                    `gorm:"default:0" json:"usage_update_count"`
	LastMeteredAt           *time.Time             `json:"last_metered_at,omitempty"`
	RoutedAt                *time.Time             `json:"routed_at,omitempty"`
	ActivatedAt             *time.Time             `json:"activated_at,omitempty"`
	ClosingAt               *time.Time             `json:"closing_at,omitempty"`
	LedgerCommittedAt       *time.Time             `json:"ledger_committed_at,omitempty"`
	BatchedAt               *time.Time             `json:"batched_at,omitempty"`
	ChainCommittedAt        *time.Time             `json:"chain_committed_at,omitempty"`
	ArchivedAt              *time.Time             `json:"archived_at,omitempty"`
	LastSeenAt              *time.Time             `json:"last_seen_at,omitempty"`
	ExpiredAt               *time.Time             `json:"expired_at,omitempty"`
	ExpiresAt               time.Time              `gorm:"not null;index:idx_session_intent_expires_at" json:"expires_at"`
	CreatedAt               time.Time              `json:"created_at"`
	UpdatedAt               time.Time              `json:"updated_at"`
	DeletedAt               gorm.DeletedAt         `gorm:"index" json:"-"`

	// Prepaid SessionEscrow PDA (same on-chain account as instant PAYG; seeds use intent UUID)
	SessionPDA         string     `gorm:"type:varchar(64)" json:"session_pda,omitempty"`
	PaymentMethod      string     `gorm:"type:varchar(50)" json:"payment_method,omitempty"`
	BuyerWallet        string     `gorm:"type:varchar(64)" json:"buyer_wallet,omitempty"`
	SellerWallet       string     `gorm:"type:varchar(64)" json:"seller_wallet,omitempty"`
	AmountLockedSOL    float64    `gorm:"type:decimal(20,9);default:0" json:"amount_locked_sol,omitempty"`
	EscrowConfirmedAt  *time.Time `json:"escrow_confirmed_at,omitempty"`


	Listing *ProxyListing `gorm:"foreignKey:ListingID" json:"listing,omitempty"`
}

func (SessionIntentRecord) TableName() string {
	return "session_intents"
}

func (s *SessionIntentRecord) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return nil
}
