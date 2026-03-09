package indexer

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

// Indexer monitors the Solana chain (via the watcher) and syncs state to the DB.
type Indexer struct {
	isRunning    bool
	pollInterval time.Duration
}

// NewIndexer creates a new indexer instance.
func NewIndexer() *Indexer {
	return &Indexer{
		pollInterval: 12 * time.Second, // ~Solana slot time
	}
}

// Start begins the indexing loop in a goroutine.
func (i *Indexer) Start() {
	if i.isRunning {
		return
	}
	i.isRunning = true
	logging.Info().Msg("Chain Indexer Started")
	go i.loop()
}

func (i *Indexer) loop() {
	ticker := time.NewTicker(i.pollInterval)
	defer ticker.Stop()
	for i.isRunning {
		select {
		case <-ticker.C:
			// Solana-based indexing is driven by the Solana watcher (internal/solana/watcher.go).
			// This loop is reserved for supplementary off-chain sync tasks.
			logging.Debug().Msg("Indexer: heartbeat")
		}
	}
}

// ChainEvent represents an event parsed from the Solana chain.
type ChainEvent struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
	Block   int64           `json:"block"`
}

// HandleProxyRegistered processes a ProxyRegistered on-chain event.
// data.Address is expected to be a Solana base58 pubkey.
func HandleProxyRegistered(payload json.RawMessage) {
	var data struct {
		Address string `json:"address"` // Solana wallet pubkey
		IP      string `json:"ip"`
		Port    int    `json:"port"`
		Type    string `json:"proxy_type"`
	}
	if err := json.Unmarshal(payload, &data); err != nil {
		logging.Error(err).Msg("Indexer: failed to parse ProxyRegistered")
		return
	}

	// Find the user by their linked Solana wallet address.
	var user models.User
	if err := db.DB.Where("wallet_address = ?", data.Address).First(&user).Error; err != nil {
		logging.Warn().Str("address", data.Address).Msg("Indexer: user not found for ProxyRegistered — creating placeholder")
		username := fmt.Sprintf("provider_%s", data.Address[:8])
		user = models.User{
			ID:            uuid.New(),
			Role:          "provider",
			TrustTier:     models.TrustTierNew,
			WalletAddress: &data.Address,
			Username:      &username,
		}
		if err := db.DB.Create(&user).Error; err != nil {
			logging.Error(err).Msg("Indexer: failed to create placeholder user")
			return
		}
	}

	logging.Info().Str("ip", data.IP).Str("user", user.ID.String()).Msg("Indexer: syncing proxy registration")

	node := models.Node{
		ID:                  uuid.New(),
		ProviderUserID:      user.ID,
		IPAddress:           data.IP,
		Port:                data.Port,
		Protocol:            data.Type,
		Region:              "unknown",
		IsHealthy:           true,
		QualityScore:        100.0,
		LastSeenAt:          time.Now(),
		IsRegisteredOnChain: true,
		Hotkey:              data.Address,
	}

	var existing models.Node
	if err := db.DB.Where("ip_address = ? AND port = ?", data.IP, data.Port).First(&existing).Error; err == nil {
		existing.IsHealthy = true
		existing.LastSeenAt = time.Now()
		existing.IsRegisteredOnChain = true
		db.DB.Save(&existing)
	} else {
		db.DB.Create(&node)
	}
}

// HandleSessionStarted processes a SessionStarted on-chain event.
// data.Buyer is expected to be a Solana base58 wallet pubkey.
func HandleSessionStarted(payload json.RawMessage) {
	var data struct {
		Buyer     string    `json:"buyer_address"` // Solana wallet pubkey
		ListingID uuid.UUID `json:"listing_id"`
		SessionID uuid.UUID `json:"session_id"`
		Duration  int       `json:"duration_seconds"`
	}
	if err := json.Unmarshal(payload, &data); err != nil {
		logging.Error(err).Msg("Indexer: failed to parse SessionStarted")
		return
	}

	logging.Info().Str("session_id", data.SessionID.String()).Msg("Indexer: detected new session on-chain")

	var buyer models.User
	if err := db.DB.Where("wallet_address = ?", data.Buyer).First(&buyer).Error; err != nil {
		logging.Warn().Str("buyer", data.Buyer).Msg("Indexer: buyer not found for SessionStarted event")
		return
	}

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
		Type:            models.SessionRotating,
		CredentialsUser: "chain_user",
		CredentialsPass: "chain_pass",
	}

	var listing models.ProxyListing
	if err := db.DB.First(&listing, "id = ?", data.ListingID).Error; err == nil {
		var node models.Node
		if err := db.DB.Where("provider_user_id = ?", listing.SellerID).First(&node).Error; err == nil {
			id := node.ID
			session.NodeID = &id
		}
	}

	if err := db.DB.Create(&session).Error; err != nil {
		logging.Error(err).Msg("Indexer: failed to create session")
	} else {
		logging.Info().Msg("Indexer: session synced to DB")
	}
}
