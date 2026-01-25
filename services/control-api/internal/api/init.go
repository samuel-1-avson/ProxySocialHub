package api

import (
	"sync"

	"github.com/proxyhubb/control-api/internal/bittensor"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/core/ports"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/events"
)

var (
	// configManager is the global singleton for dynamic configuration
	configManager *config.ConfigManager
	// configOnce ensures thread-safe initialization
	configOnce sync.Once

	// eventQueue is the global singleton for the event queue
	eventQueue events.EventQueue
	// oracleSigner is the global singleton for the oracle signer
	oracleSigner *crypto.Signer
	// bittensorClient is the global singleton for the bittensor client
	bittensorClient *bittensor.Client
	// marketplaceService is the core logic engine
	marketplaceService ports.MarketplaceService

	queueOnce       sync.Once
	signerOnce      sync.Once
	bittensorOnce   sync.Once
	marketplaceOnce sync.Once
)

// InitEventQueue initializes the global event queue
func InitEventQueue(q events.EventQueue) {
	queueOnce.Do(func() {
		eventQueue = q
	})
}

// GetEventQueue returns the global event queue
func GetEventQueue() events.EventQueue {
	return eventQueue
}

// InitOracleSigner initializes the global oracle signer
func InitOracleSigner(s *crypto.Signer) {
	signerOnce.Do(func() {
		oracleSigner = s
	})
}

// GetOracleSigner returns the global oracle signer
func GetOracleSigner() *crypto.Signer {
	return oracleSigner
}

// InitBittensorClient initializes the global bittensor client
func InitBittensorClient(c *bittensor.Client) {
	bittensorOnce.Do(func() {
		bittensorClient = c
	})
}

// GetBittensorClient returns the global bittensor client
func GetBittensorClient() *bittensor.Client {
	return bittensorClient
}

// InitMarketplaceService initializes the global marketplace service
func InitMarketplaceService(s ports.MarketplaceService) {
	marketplaceOnce.Do(func() {
		marketplaceService = s
	})
}

// GetMarketplaceService returns the global marketplace service
func GetMarketplaceService() ports.MarketplaceService {
	return marketplaceService
}

// InitConfigManager initializes the global config manager
func InitConfigManager(m *config.ConfigManager) {
	configOnce.Do(func() {
		configManager = m
	})
}

// GetConfigManager returns the global config manager
func GetConfigManager() *config.ConfigManager {
	return configManager
}
