package api

import (
	"strings"

	"github.com/proxyhubb/control-api/internal/geo"
	"github.com/proxyhubb/control-api/internal/geoip"
	"github.com/proxyhubb/control-api/internal/indexer"
)

// normalizeGatewayGeo prepares IP and location fields before persisting a gateway node.
func normalizeGatewayGeo(ip, country, city string) (string, string, string) {
	ip = geoip.NormalizeIPForGeo(strings.TrimSpace(ip))
	country, city = geo.NormalizeProviderLocation(country, city)
	return ip, country, city
}

// normalizeProviderNodeGeo prepares create/update payloads from the provider API.
func normalizeProviderNodeGeo(ip, country, city string) (string, string, string) {
	return normalizeGatewayGeo(ip, country, city)
}

// scheduleNodeGeoEnrich syncs explorer_nodes and resolves coordinates immediately.
func scheduleNodeGeoEnrich(providerNodeID string) {
	if providerNodeID == "" {
		return
	}
	go func(id string) {
		if ns := indexer.GetNodeSync(); ns != nil {
			_ = ns.SyncNodeNow(id)
		}
		geoip.EnrichExplorerForProviderNode(id)
		geoip.ResolveNextBatch()
	}(providerNodeID)
}
