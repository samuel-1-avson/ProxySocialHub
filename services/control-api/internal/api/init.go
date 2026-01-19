package api

import (
	"sync"

	"github.com/proxyhubb/control-api/internal/bittensor"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/events"
)

var (
	// eventQueue is the global singleton for the event queue
	eventQueue events.EventQueue
	// oracleSigner is the global singleton for the oracle signer
	oracleSigner *crypto.Signer
	// bittensorClient is the global singleton for the bittensor client
	bittensorClient *bittensor.Client
	queueOnce       sync.Once
	signerOnce      sync.Once
	bittensorOnce   sync.Once
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
