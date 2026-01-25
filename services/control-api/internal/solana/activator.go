// Package solana - Session activator that auto-activates sessions when escrow is confirmed
package solana

import (
	"context"
	"log"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// SessionActivator handles automatic session activation from escrow events
type SessionActivator struct {
	db *gorm.DB
}

// NewSessionActivator creates a new session activator
func NewSessionActivator() *SessionActivator {
	return &SessionActivator{
		db: db.DB,
	}
}

// HandleEscrowEvent processes escrow events and updates sessions
func (a *SessionActivator) HandleEscrowEvent(event EscrowEvent) {
	switch event.Type {
	case "initialized":
		a.onEscrowInitialized(event)
	case "settled":
		a.onEscrowSettled(event)
	case "refunded":
		a.onEscrowRefunded(event)
	}
}

// onEscrowInitialized handles new escrow creation
func (a *SessionActivator) onEscrowInitialized(event EscrowEvent) {
	log.Printf("[SessionActivator] Escrow initialized: %s (Buyer: %s, Seller: %s)",
		event.EscrowPDA, event.Buyer, event.Seller)

	if a.db == nil {
		log.Printf("[SessionActivator] Database not available, skipping session activation")
		return
	}

	// Find pending orders that match this escrow
	var order models.Order
	result := a.db.Where("buyer_wallet = ? AND seller_wallet = ? AND status = ?",
		event.Buyer, event.Seller, "pending_escrow").First(&order)

	if result.Error != nil {
		// No matching pending order - create a new one
		log.Printf("[SessionActivator] No pending order found, escrow may be direct on-chain")

		// Look up users by wallet
		var buyer models.User
		var seller models.User

		if err := a.db.Where("wallet_address = ?", event.Buyer).First(&buyer).Error; err != nil {
			log.Printf("[SessionActivator] Buyer not found in system: %s", event.Buyer)
			return
		}

		if err := a.db.Where("wallet_address = ?", event.Seller).First(&seller).Error; err != nil {
			log.Printf("[SessionActivator] Seller not found in system: %s", event.Seller)
			return
		}

		// Find a listing from this seller (default to first active one)
		var listing models.ProxyListing
		if err := a.db.Where("provider_id = ? AND status = ?", seller.ID, "active").First(&listing).Error; err != nil {
			log.Printf("[SessionActivator] No active listing for seller: %s", event.Seller)
			return
		}

		// Create order from escrow
		order = models.Order{
			ID:               uuid.New(),
			BuyerID:          buyer.ID,
			SellerID:         seller.ID,
			ListingID:        listing.ID,
			BandwidthGB:      float64(event.LimitGB),
			PricePerGB:       0, // On-chain price
			TotalPrice:       float64(event.Amount) / 1e9,
			Status:           models.OrderStatusActive,
			EscrowPDA:        event.EscrowPDA,
			BuyerWallet:      event.Buyer,
			SellerWallet:     event.Seller,
			AmountLockedSOL:  float64(event.Amount) / 1e9,
			BandwidthLimitGB: event.LimitGB,
			PaymentMethod:    "solana_escrow",
			TxSignature:      event.TxSignature,
		}

		if err := a.db.Create(&order).Error; err != nil {
			log.Printf("[SessionActivator] Failed to create order: %v", err)
			return
		}

		log.Printf("[SessionActivator] Created order %s from on-chain escrow", order.ID)

		// Create session for this order
		a.createSessionForOrder(&order, &seller, event, false)
		return
	}

	// Update existing order with escrow details
	updates := map[string]interface{}{
		"escrow_pda":        event.EscrowPDA,
		"tx_signature":      event.TxSignature,
		"amount_locked_sol": float64(event.Amount) / 1e9,
		"status":            models.OrderStatusActive,
	}

	if err := a.db.Model(&order).Updates(updates).Error; err != nil {
		log.Printf("[SessionActivator] Failed to update order: %v", err)
		return
	}

	log.Printf("[SessionActivator] Activated order %s (Escrow: %s)", order.ID, event.EscrowPDA)

	// Phase 3: NFT Access Check
	// If buyer has the Premium NFT, we could grant them bonus bandwidth or lower tiers.
	// For now, we log the status and potentially upgrade the session.
	hasPremium := false
	oracle := GetOracleClient() // Assuming a global getter exists or adding it
	if oracle != nil {
		buyerPub, _ := sol.PublicKeyFromBase58(event.Buyer)
		premiumMint, _ := sol.PublicKeyFromBase58("NFT_MINT_ADDRESS_HERE") // Placeholder
		if ok, _ := oracle.HasNFT(context.Background(), buyerPub, premiumMint); ok {
			hasPremium = true
			log.Printf("[SessionActivator] User %s holds Premium NFT pass!", event.Buyer)
		}
	}

	// Create a session for this order
	var seller models.User
	if err := a.db.First(&seller, order.SellerID).Error; err == nil {
		a.createSessionForOrder(&order, &seller, event, hasPremium)
	}
}

// onEscrowSettled handles escrow settlement
func (a *SessionActivator) onEscrowSettled(event EscrowEvent) {
	log.Printf("[SessionActivator] Escrow settled: %s", event.EscrowPDA)

	if a.db == nil {
		return
	}

	// Find and update the order
	var order models.Order
	if err := a.db.Where("escrow_pda = ?", event.EscrowPDA).First(&order).Error; err != nil {
		log.Printf("[SessionActivator] No order found for settled escrow: %s", event.EscrowPDA)
		return
	}

	// Update order status
	order.Status = models.OrderStatusCompleted
	if err := a.db.Save(&order).Error; err != nil {
		log.Printf("[SessionActivator] Failed to update order: %v", err)
		return
	}

	// End any active sessions linked to this order
	if order.SessionID != nil {
		a.db.Model(&models.Session{}).
			Where("id = ? AND status = ?", *order.SessionID, models.SessionActive).
			Update("status", models.SessionTerminated)
	}

	log.Printf("[SessionActivator] Order %s marked as completed", order.ID)
}

// onEscrowRefunded handles escrow refund
func (a *SessionActivator) onEscrowRefunded(event EscrowEvent) {
	log.Printf("[SessionActivator] Escrow refunded: %s", event.EscrowPDA)

	if a.db == nil {
		return
	}

	// Find and update the order
	var order models.Order
	if err := a.db.Where("escrow_pda = ?", event.EscrowPDA).First(&order).Error; err != nil {
		log.Printf("[SessionActivator] No order found for refunded escrow: %s", event.EscrowPDA)
		return
	}

	// Update order status
	order.Status = models.OrderStatusRefunded
	if err := a.db.Save(&order).Error; err != nil {
		log.Printf("[SessionActivator] Failed to update order: %v", err)
		return
	}

	// Cancel any active sessions
	if order.SessionID != nil {
		a.db.Model(&models.Session{}).
			Where("id = ? AND status = ?", *order.SessionID, models.SessionActive).
			Update("status", models.SessionTerminated)
	}

	log.Printf("[SessionActivator] Order %s marked as refunded", order.ID)
}

// createSessionForOrder creates a proxy session for an activated order
func (a *SessionActivator) createSessionForOrder(order *models.Order, seller *models.User, event EscrowEvent, isPremium bool) {
	// Find provider's node
	var node models.ProviderNode
	if err := a.db.Where("user_id = ? AND status = ?", seller.ID, "online").First(&node).Error; err != nil {
		log.Printf("[SessionActivator] No online node found for provider")
		return
	}

	bandwidthLimit := int64(event.LimitGB) * 1024 * 1024 * 1024
	if isPremium {
		// Example: Give 20% bonus bandwidth to NFT holders
		bandwidthLimit = int64(float64(bandwidthLimit) * 1.2)
		log.Printf("[SessionActivator] Applying 20%% bandwidth bonus for Premium NFT")
	}

	// Create session
	session := models.Session{
		ID:             uuid.New(),
		UserID:         order.BuyerID,
		NodeID:         &node.ID,
		ListingID:      &order.ListingID,
		Type:           models.SessionRotating,
		Status:         models.SessionActive,
		TxHash:         event.TxSignature,
		BandwidthLimit: bandwidthLimit,
		StartTime:      time.Now(),
	}

	if err := a.db.Create(&session).Error; err != nil {
		log.Printf("[SessionActivator] Failed to create session: %v", err)
		return
	}

	// Link session to order
	order.SessionID = &session.ID
	a.db.Save(order)

	log.Printf("[SessionActivator] Created session %s for order %s", session.ID, order.ID)
}

// Global activator instance
var globalActivator *SessionActivator

// InitSessionActivator initializes the global session activator
func InitSessionActivator() {
	globalActivator = NewSessionActivator()
}

// GetSessionActivator returns the global session activator
func GetSessionActivator() *SessionActivator {
	return globalActivator
}

// RegisterSessionActivatorWithWatcher registers the session activator with the event watcher
func RegisterSessionActivatorWithWatcher() {
	if globalWatcher == nil || globalActivator == nil {
		return
	}

	globalWatcher.OnEvent(globalActivator.HandleEscrowEvent)
	log.Printf("[SessionActivator] Registered with event watcher")
}
