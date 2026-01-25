package indexer

import (
	"context"
	"log"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/solana"
)

// RegistrySyncWorker maintains parity between Solana on-chain registry and local DB
type RegistrySyncWorker struct {
	pollInterval time.Duration
	maxRetries   int
}

func NewRegistrySyncWorker(interval time.Duration) *RegistrySyncWorker {
	if interval == 0 {
		interval = 5 * time.Minute
	}
	return &RegistrySyncWorker{
		pollInterval: interval,
		maxRetries:   5,
	}
}

func (w *RegistrySyncWorker) Start(ctx context.Context) {
	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()

	log.Printf("Registry Sync Worker started (Interval: %v)", w.pollInterval)

	// Initial sync
	w.sync(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.sync(ctx)
		}
	}
}

func (w *RegistrySyncWorker) sync(ctx context.Context) {
	log.Println("Starting On-Chain Registry Sync...")

	// 1. Fetch all nodes from Solana Registry
	// In a real industrial scenario, we'd use solana.GetRegistryNodes()
	// which iterates over program accounts.
	nodes, err := solana.GetRegistryNodes()
	if err != nil {
		log.Printf("Error fetching on-chain nodes: %v. Retrying with backoff...", err)
		return
	}

	// 2. Reconciliation Logic
	for _, node := range nodes {
		// Check if node exists in local DB
		exists, err := db.NodeExists(node.Pubkey)
		if err != nil {
			log.Printf("DB error checking node %s: %v", node.Pubkey, err)
			continue
		}

		if !exists {
			log.Printf("Found new on-chain node: %s. Provisioning local record...", node.Pubkey)
			err = db.CreateNodeFromRegistry(node)
			if err != nil {
				log.Printf("Failed to create local node for %s: %v", node.Pubkey, err)
			}
		} else {
			// Update existing node metadata (status, latency, etc.)
			err = db.UpdateNodeFromRegistry(node)
			if err != nil {
				log.Printf("Failed to update local node %s: %v", node.Pubkey, err)
			}
		}
	}

	log.Printf("On-Chain Registry Sync complete. Processed %d nodes.", len(nodes))
}
