package worker

import (
	"context"
	"time"

	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/logging"
)

// ZKSettlementWorker manages the background loop for confidential ZK-based settlement
type ZKSettlementWorker struct {
	aggregator *billing.ZKAggregator
	interval   time.Duration
}

func NewZKSettlementWorker() *ZKSettlementWorker {
	return &ZKSettlementWorker{
		aggregator: billing.NewZKAggregator(),
		interval:   5 * time.Minute, // Every 5 minutes for the prototype
	}
}

// Start initiates the background settlement loop
func (w *ZKSettlementWorker) Start(ctx context.Context) {
	logging.Info().Msg("ZKSettlementWorker: Background loop starting...")

	GoSupervised("ZKSettlementWorker", 5*time.Second, func() {
		ticker := time.NewTicker(w.interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				logging.Info().Msg("ZKSettlementWorker: Shutting down background loop...")
				return
			case <-ticker.C:
				RunSafely("ZKSettlementWorker.cycle", func() {
					if err := w.aggregator.ProcessSignedProofs(ctx); err != nil {
						logging.Error(err).Msg("ZKSettlementWorker: Failed to process proofs")
					}
				})
			}
		}
	})
}
