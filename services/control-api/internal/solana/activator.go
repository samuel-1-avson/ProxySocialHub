// Package solana - Session activator that auto-activates sessions when escrow is confirmed
package solana

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/orders/fsm"
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

// HandleEscrowEvent processes escrow events and updates sessions.
// N-04: Also writes/refreshes the BlockchainStateCache entry for the escrow PDA.
func (a *SessionActivator) HandleEscrowEvent(event EscrowEvent) {
	// N-04: Upsert cache entry so the explorer and billing queries can read
	// on-chain state without hitting the RPC on every request.
	a.upsertBlockchainStateCache(event)

	switch event.Type {
	case "initialized":
		a.onEscrowInitialized(event)
	case "settled":
		a.onEscrowSettled(event)
	case "refunded":
		a.onEscrowRefunded(event)
	}
}

// upsertBlockchainStateCache writes or refreshes the cache row for this escrow PDA (N-04).
func (a *SessionActivator) upsertBlockchainStateCache(event EscrowEvent) {
	if a.db == nil || event.EscrowPDA == "" {
		return
	}

	// Map event type to a human-readable status string.
	status := event.Type // "initialized" | "settled" | "refunded"
	sig := event.TxSignature

	// Build a lightweight JSON payload from the event fields.
	dataJSON := fmt.Sprintf(
		`{"buyer":%q,"seller":%q,"amount_lamports":%d,"limit_gb":%d,"event_type":%q}`,
		event.Buyer, event.Seller, event.Amount, event.LimitGB, event.Type,
	)

	entry := models.BlockchainStateCache{
		PDA:           event.EscrowPDA,
		ProgramID:     globalProgramID(),
		AccountType:   models.AccountEscrow,
		Data:          dataJSON,
		Slot:          0, // watcher doesn't expose slot; populated by RPC sync job
		Signature:     &sig,
		LastSyncedAt:  time.Now(),
		BuyerAddress:  &event.Buyer,
		SellerAddress: &event.Seller,
		Status:        &status,
	}

	// UPSERT: update Data, Status, Signature, LastSyncedAt on PDA conflict.
	if err := a.db.
		Where(models.BlockchainStateCache{PDA: event.EscrowPDA}).
		Assign(models.BlockchainStateCache{
			Data:         entry.Data,
			Status:       &status,
			Signature:    &sig,
			LastSyncedAt: entry.LastSyncedAt,
		}).
		FirstOrCreate(&entry).Error; err != nil {
		log.Printf("[N-04] Failed to upsert blockchain state cache for %s: %v", event.EscrowPDA, err)
	}
}

// globalProgramID returns the configured Solana program ID string.
func globalProgramID() string {
	if c := globalOracleClient.Load(); c != nil {
		return c.programID.String()
	}
	return ""
}

// onEscrowInitialized handles new escrow creation
func (a *SessionActivator) onEscrowInitialized(event EscrowEvent) {
	log.Printf("[SessionActivator] Escrow initialized: %s (Buyer: %s, Seller: %s)",
		event.EscrowPDA, event.Buyer, event.Seller)

	if a.db == nil {
		log.Printf("[SessionActivator] Database not available, skipping session activation")
		return
	}

	// Prefer PDA match (same as escrow_listener); fall back to wallet + pre-active statuses.
	var order models.Order
	err := a.db.Where("escrow_pda = ?", event.EscrowPDA).First(&order).Error
	if err != nil {
		err = a.db.Where(
			"buyer_wallet = ? AND seller_wallet = ? AND status IN ?",
			event.Buyer,
			event.Seller,
			[]models.OrderStatus{models.OrderStatusPending, models.OrderStatusPendingPayment},
		).Order("created_at DESC").First(&order).Error
	}

	if err != nil {
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
		if err := a.db.Where("seller_id = ? AND status = ?", seller.ID, models.ListingStatusActive).First(&listing).Error; err != nil {
			log.Printf("[SessionActivator] No active listing for seller: %s", event.Seller)
			return
		}

		if err := fsm.AssertCreatableStatus(models.OrderStatusActive, "solana.activator.create"); err != nil {
			log.Printf("[SessionActivator] Refusing create with status active: %v", err)
			return
		}

		// Create order from escrow (initial status validated as "" ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ active)
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

	if err := fsm.TransitionOrder(a.db, &order, models.OrderStatusActive, "solana.activator.init", map[string]interface{}{
		"escrow_pda":        event.EscrowPDA,
		"tx_signature":      event.TxSignature,
		"amount_locked_sol": float64(event.Amount) / 1e9,
		"buyer_wallet":      event.Buyer,
		"seller_wallet":     event.Seller,
		"payment_method":    "solana_escrow",
	}); err != nil {
		log.Printf("[SessionActivator] Invalid/failed activate transition for order %s: %v", order.ID, err)
		return
	}
	order.EscrowPDA = event.EscrowPDA
	order.TxSignature = event.TxSignature
	order.AmountLockedSOL = float64(event.Amount) / 1e9
	order.BuyerWallet = event.Buyer
	order.SellerWallet = event.Seller
	order.PaymentMethod = "solana_escrow"

	log.Printf("[SessionActivator] Activated order %s (Escrow: %s)", order.ID, event.EscrowPDA)

	// Existing marketplace orders already have a linked (disabled) session from createOrder.
	// Activate that session ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â do not create a replacement that orphans credentials.
	if order.SessionID != nil {
		if err := marketplace.ActivateOrderSession(context.Background(), order.ID); err != nil {
			log.Printf("[SessionActivator] Order %s active but session sync failed (retry worker will reattempt): %v", order.ID, err)
			orderID := order.ID
			go func() {
				time.Sleep(2 * time.Second)
				if retryErr := marketplace.ActivateOrderSession(context.Background(), orderID); retryErr != nil {
					log.Printf("[SessionActivator] Immediate retry failed for order %s: %v", orderID, retryErr)
				}
			}()
		}
		return
	}

	// Phase 3: NFT Access Check (direct on-chain orders without a pre-created session)
	hasPremium := false
	oracle := GetOracleClient()
	if oracle != nil {
		premiumMintStr := os.Getenv("MINT_PREMIUM_PASS")
		if premiumMintStr == "" {
			premiumMintStr = os.Getenv("MINT_GOLD_PASS")
		}

		if premiumMintStr != "" {
			buyerPub, err := sol.PublicKeyFromBase58(event.Buyer)
			if err != nil {
				log.Printf("[SessionActivator] Skipping premium NFT check for invalid buyer wallet %s: %v", event.Buyer, err)
			} else if premiumMint, err := sol.PublicKeyFromBase58(premiumMintStr); err != nil {
				log.Printf("[SessionActivator] Skipping premium NFT check due to invalid mint configuration: %v", err)
			} else if ok, err := oracle.HasNFT(context.Background(), buyerPub, premiumMint); err != nil {
				log.Printf("[SessionActivator] Premium NFT check failed for buyer %s: %v", event.Buyer, err)
			} else if ok {
				hasPremium = true
				log.Printf("[SessionActivator] User %s holds Premium NFT pass!", event.Buyer)
			}
		}
	}

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

	if err := fsm.TransitionOrder(a.db, &order, models.OrderStatusCompleted, "solana.activator.settled", nil); err != nil {
		log.Printf("[SessionActivator] Invalid/failed complete transition for order %s: %v", order.ID, err)
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

	if err := fsm.TransitionOrder(a.db, &order, models.OrderStatusRefunded, "solana.activator.refunded", nil); err != nil {
		log.Printf("[SessionActivator] Invalid/failed refund transition for order %s: %v", order.ID, err)
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

	// sessions.node_id references the nodes mirror row, not provider_nodes.id (the
	// purchase flow does the same); nil when the provider node has no mirror yet.
	// Create session
	session := models.Session{
		ID:             uuid.New(),
		UserID:         order.BuyerID,
		NodeID:         marketplace.SessionNodeIDForProvider(&node),
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
