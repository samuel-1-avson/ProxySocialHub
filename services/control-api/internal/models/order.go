package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// OrderStatus represents the status of an order
type OrderStatus string

const (
	OrderStatusPending        OrderStatus = "pending"
	OrderStatusPendingPayment OrderStatus = "pending_payment" // Escrow initiated, awaiting on-chain confirmation
	OrderStatusActive         OrderStatus = "active"
	OrderStatusCompleted      OrderStatus = "completed"
	OrderStatusDisputed       OrderStatus = "disputed"
	OrderStatusRefunded       OrderStatus = "refunded"
	OrderStatusCancelled      OrderStatus = "cancelled"
)

// Order represents a purchase of proxy bandwidth
type Order struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	BuyerID   uuid.UUID `gorm:"type:uuid;not null;index:idx_order_buyer" json:"buyer_id"`
	SellerID  uuid.UUID `gorm:"type:uuid;not null;index:idx_order_seller" json:"seller_id"`
	ListingID uuid.UUID `gorm:"type:uuid;not null;index:idx_order_listing" json:"listing_id"`

	// Purchase details
	BandwidthGB float64 `gorm:"not null" json:"bandwidth_gb"`
	PricePerGB  float64 `gorm:"not null" json:"price_per_gb"`
	TotalPrice  float64 `gorm:"not null" json:"total_price"`

	Status    OrderStatus `gorm:"size:50;default:'pending';index:idx_order_status" json:"status"`
	TxHash    string      `gorm:"size:255" json:"tx_hash,omitempty"`
	SessionID *uuid.UUID  `gorm:"type:uuid" json:"session_id,omitempty"`

	// Solana Escrow Fields
	EscrowPDA        string  `gorm:"size:64" json:"escrow_pda,omitempty"`
	BuyerWallet      string  `gorm:"size:64;index:idx_order_buyer_wallet" json:"buyer_wallet,omitempty"`
	SellerWallet     string  `gorm:"size:64;index:idx_order_seller_wallet" json:"seller_wallet,omitempty"`
	AmountLockedSOL  float64 `json:"amount_locked_sol,omitempty"`
	BandwidthLimitGB uint64  `json:"bandwidth_limit_gb,omitempty"`
	PaymentMethod    string  `gorm:"size:50" json:"payment_method,omitempty"` // "fiat", "solana_escrow"
	TxSignature      string  `gorm:"size:128" json:"tx_signature,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Preloaded relations
	Buyer   *User         `gorm:"foreignKey:BuyerID" json:"buyer,omitempty"`
	Seller  *User         `gorm:"foreignKey:SellerID" json:"seller,omitempty"`
	Listing *ProxyListing `gorm:"foreignKey:ListingID" json:"listing,omitempty"`
	Session *Session      `gorm:"foreignKey:SessionID" json:"session,omitempty"`
}

// TableName sets the table name for Order
func (Order) TableName() string {
	return "orders"
}

// BeforeCreate generates a UUID if not set
func (o *Order) BeforeCreate(tx *gorm.DB) error {
	if o.ID == uuid.Nil {
		o.ID = uuid.New()
	}
	return nil
}

// CreateOrderRequest represents a request to create an order
type CreateOrderRequest struct {
	ListingID   uuid.UUID   `json:"listing_id" binding:"required"`
	BandwidthGB float64     `json:"bandwidth_gb" binding:"required,gt=0"`
	SessionType SessionType `json:"session_type"` // "rotating" or "sticky"; defaults to rotating
}
