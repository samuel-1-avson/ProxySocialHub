package treasury

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

type GhostProber struct {
	watchtower *Watchtower
}

func NewGhostProber(w *Watchtower) *GhostProber {
	return &GhostProber{
		watchtower: w,
	}
}

// StartProbingLoop runs the ghost probing service
func (gp *GhostProber) StartProbingLoop(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				gp.runProbeRound(ctx)
			}
		}
	}()
}

func (gp *GhostProber) runProbeRound(ctx context.Context) {
	// 1. Fetch random set of active nodes
	var nodes []models.ProviderNode
	if err := db.DB.Where("status = ?", models.NodeOnline).Order("RANDOM()").Limit(5).Find(&nodes).Error; err != nil {
		logging.Error(err).Msg("Failed to fetch nodes for probing")
		return
	}

	for _, node := range nodes {
		go gp.probeNode(ctx, node)
	}
}

func (gp *GhostProber) probeNode(ctx context.Context, node models.ProviderNode) {
	start := time.Now()

	// Simulate connectivity test (In real world, this would attempt a proxy connection)
	// For this implementation, we check the node's reporting endpoint if it exists
	target := fmt.Sprintf("http://%s:8080/health", node.IPAddress)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(target)

	latency := time.Since(start)

	if err != nil || resp.StatusCode != http.StatusOK {
		logging.Warn().
			Str("node", node.Name).
			Str("ip", node.IPAddress).
			Err(err).
			Msg("Ghost Probe FAILED")

		gp.watchtower.RecordSecurityAnomaly(ctx, "Ghost Probe Failure", node.ID.String())
		return
	}
	defer resp.Body.Close()

	logging.Info().
		Str("node", node.Name).
		Int64("latency_ms", latency.Milliseconds()).
		Msg("Ghost Probe SUCCESS")
}
