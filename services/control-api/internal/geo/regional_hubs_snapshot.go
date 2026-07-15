package geo

// HubSnapshot is a minimal hub record for cross-language parity checks.
type HubSnapshot struct {
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
}

// RegionalHubsSnapshot returns hub name and coordinates keyed by ISO country code.
func RegionalHubsSnapshot() map[string][]HubSnapshot {
	out := make(map[string][]HubSnapshot, len(regionalHubsByCountry))
	for cc, hubs := range regionalHubsByCountry {
		snaps := make([]HubSnapshot, len(hubs))
		for i, h := range hubs {
			snaps[i] = HubSnapshot{Name: h.Name, Lat: h.Lat, Lon: h.Lon}
		}
		out[cc] = snaps
	}
	return out
}

// RegionalHubStats returns aggregate hub table metadata for health endpoints.
func RegionalHubStats() (countries, hubs int) {
	for _, list := range regionalHubsByCountry {
		countries++
		hubs += len(list)
	}
	return countries, hubs
}
