package indexer

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/api"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

// Indexer Service monitors the blockchain (via Bridge) and syncs state
type Indexer struct {
	isRunning     bool
	lastSyncBlock int64
	pollInterval  time.Duration
}

// NewIndexer creates a new indexer instance
func NewIndexer() *Indexer {
	return &Indexer{
		pollInterval:  10 * time.Second, // Bittensor blocks are ~12s
		lastSyncBlock: 0,
	}
}

// Start begins the indexing loop in a goroutine
func (i *Indexer) Start() {
	if i.isRunning {
		return
	}
	i.isRunning = true

	logging.Info().Msg("⛓️  Chain Indexer Started")

	go i.loop()
}

func (i *Indexer) loop() {
	ticker := time.NewTicker(i.pollInterval)
	defer ticker.Stop()

	for i.isRunning {
		select {
		case <-ticker.C:
			i.sync()
		}
	}
}

func (i *Indexer) sync() {
	// 1. Fetch latest block/events from Bridge
	// We assume Bridge has an endpoint /events?from_block=X
	// For MVP, we'll simulate fetching events if the bridge isn't fully ready.

	client := api.GetBittensorClient()
	if client == nil {
		logging.Warn().Msg("Indexer: Bittensor Client not ready")
		return
	}

	// Mocking the fetch logic for now as Bridge endpoint needs to be defined
	// In real impl: events, err := client.GetEvents(i.lastSyncBlock)

	logging.Info().Int64("last_block", i.lastSyncBlock).Msg("Indexer: Syncing chain state...")

	// MOCK: If first run, simulate a ProxyRegistered event for verification
	if i.lastSyncBlock == 0 {
		i.lastSyncBlock = 100 // Set to some block

		// Mock Proxy Payload
		payload := []byte(`{"address": "5DTestProviderAddressIndexer", "ip": "1.2.3.4", "port": 8080, "proxy_type": "http"}`)
		ev := ChainEvent{Type: "ProxyRegistered", Payload: payload, Block: 100}
		i.processEvent(ev)
	}

	// Simulated Event Processing
	// if events found:
	//    for ev := range events {
	//        i.processEvent(ev)
	//    }
	//    i.lastSyncBlock = latestBlock
}

// Event types
type ChainEvent struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
	Block   int64           `json:"block"`
}

func (i *Indexer) processEvent(ev ChainEvent) {
	switch ev.Type {
	case "ProxyRegistered":
		i.handleProxyRegistered(ev.Payload)
	case "SessionStarted":
		i.handleSessionStarted(ev.Payload)
	}
}

func (i *Indexer) handleProxyRegistered(payload json.RawMessage) {
	var data struct {
		Address string `json:"address"`
		IP      string `json:"ip"`
		Port    int    `json:"port"`
		Type    string `json:"proxy_type"`
	}
	if err := json.Unmarshal(payload, &data); err != nil {
		logging.Error(err).Msg("Indexer: Failed to parse ProxyRegistered")
		return
	}

	// Update DB
	// 1. Find User by Address
	var user models.User
	if err := db.DB.Where("bittensor_address = ?", data.Address).First(&user).Error; err != nil {
		logging.Warn().Str("address", data.Address).Msg("Indexer: User not found for ProxyRegistered event, creating placeholder")
		// Create basic user
		username := fmt.Sprintf("provider_%s", data.Address[:8])
		user = models.User{
			ID:               uuid.New(),
			Role:             "provider",
			TrustTier:        models.TrustTierNew,
			BittensorAddress: &data.Address,
			Username:         &username,
		}
		if err := db.DB.Create(&user).Error; err != nil {
			logging.Error(err).Msg("Indexer: Failed to create placeholder user")
			return
		}
	}

	logging.Info().Str("ip", data.IP).Str("user", user.ID.String()).Msg("Indexer: Syncing Proxy Registration")

	// 2. Create/Update Provider Node
	node := models.Node{
		ID:                  uuid.New(),
		ProviderUserID:      user.ID,
		IPAddress:           data.IP,
		Port:                data.Port,
		Protocol:            data.Type, // assuming type maps to protocol
		Region:              "unknown",
		IsHealthy:           true,
		QualityScore:        100.0,
		LastSeenAt:          time.Now(),
		IsRegisteredOnChain: true,
		Hotkey:              data.Address, // Using address as hotkey for simple mapping
	}

	// Check availability
	var existing models.Node
	if err := db.DB.Where("ip_address = ? AND port = ?", data.IP, data.Port).First(&existing).Error; err == nil {
		// Update existing
		existing.IsHealthy = true
		existing.LastSeenAt = time.Now()
		existing.IsRegisteredOnChain = true
		db.DB.Save(&existing)
	} else {
		// Create new
		db.DB.Create(&node)
	}
}

func (i *Indexer) handleSessionStarted(payload json.RawMessage) {
	var data struct {
		Buyer     string    `json:"buyer_address"` // Bittensor Address
		ListingID uuid.UUID `json:"listing_id"`
		SessionID uuid.UUID `json:"session_id"`
		Duration  int       `json:"duration_seconds"` // or hours
	}
	if err := json.Unmarshal(payload, &data); err != nil {
		logging.Error(err).Msg("Indexer: Failed to parse SessionStarted")
		return
	}

	logging.Info().Str("session_id", data.SessionID.String()).Msg("Indexer: Detected new Session on-chain")

	// 1. Find User by Address
	var buyer models.User
	if err := db.DB.Where("bittensor_address = ?", data.Buyer).First(&buyer).Error; err != nil {
		logging.Warn().Msg("Indexer: Buyer not found for SessionStarted event")
		return
	}

	// 2. Create Session Record
	endTime := time.Now().Add(time.Duration(data.Duration) * time.Second)
	session := models.Session{
		ID:              data.SessionID,
		UserID:          buyer.ID,
		Status:          "active",
		StartTime:       time.Now(),
		EndTime:         endTime,
		ExpiresAt:       &endTime,
		BytesUsed:       0,
		BandwidthLimit:  0,
		Type:            models.SessionRotating, // Default type or derived from listing
		CredentialsUser: "chain_user",
		CredentialsPass: "chain_pass",
	}

	// Fetch Listing to get Provider/Node info
	var listing models.ProxyListing
	if err := db.DB.First(&listing, "id = ?", data.ListingID).Error; err == nil {
		// If listing has a specific NodeID linked (not in current model, but let's assume we search nodes by provider)
		// For now, finding ANY node by this provider
		var node models.Node
		if err := db.DB.Where("provider_user_id = ?", listing.SellerID).First(&node).Error; err == nil {
			id := node.ID
			session.NodeID = &id
		}
	}

	if err := db.DB.Create(&session).Error; err != nil {
		logging.Error(err).Msg("Indexer: Failed to create session")
	} else {
		logging.Info().Msg("Indexer: Session synced to DB")
	}
}
