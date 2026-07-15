package worker

import (
	"log"
	"os"
	"time"

	"github.com/proxyhubb/control-api/internal/map/topology"
)

// OnLinkTopologyAggregated is wired from main to broadcast WS link_update hints.
var OnLinkTopologyAggregated func(linkCount int, topologyAvailable bool)

// StartMapTopologyWorker aggregates session intents into map_node_links.
func StartMapTopologyWorker() {
	if os.Getenv("MAP_TOPOLOGY_ENABLED") == "false" {
		log.Println("[MapTopology] Aggregator disabled (MAP_TOPOLOGY_ENABLED=false)")
		return
	}

	log.Println("[Worker] Supervised MapTopology aggregator started")

	GoSupervised("MapTopologyAggregator", 5*time.Second, func() {
		time.Sleep(15 * time.Second)

		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()

		RunSafely("MapTopologyAggregator.cycle", runMapTopologyAggregate)

		for range ticker.C {
			RunSafely("MapTopologyAggregator.cycle", runMapTopologyAggregate)
		}
	})
}

func runMapTopologyAggregate() {
	count, err := topology.AggregateSessionLinks(time.Now())
	if err != nil {
		log.Printf("[MapTopology] aggregate failed: %v", err)
		return
	}
	if OnLinkTopologyAggregated != nil {
		OnLinkTopologyAggregated(count, count > 0)
	}
}
