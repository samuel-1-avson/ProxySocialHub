package geo

import (
	"math"
	"strings"
)

// maxRegionalHubSnapKm bounds coordinate-to-hub snapping. Coordinates are
// evidence about where a node really exits; a declared country is a claim.
// When the closest hub in the claimed country is farther than this, the two
// disagree (classic failure: a Ghana node's coordinates snapped to the
// nearest US hub, Boston, because a stale listing country said "US").
// Refusing the snap lets callers fall back instead of publishing a pin on
// the wrong continent. Text (city/region) matches are not distance-bound.
const maxRegionalHubSnapKm = 2500

// regionalHub is a map anchor for provider/validator density (city-region level, not street GPS).
type regionalHub struct {
	Name    string
	Lat     float64
	Lon     float64
	Aliases []string
}

// ResolveRegionalHub maps a node to the nearest major regional hub in its country.
// Uses city/region names when present, otherwise snaps coordinates to the closest hub.
func ResolveRegionalHub(country, city, region string, lat, lon float64) (hubName string, hubLat, hubLon float64, ok bool) {
	hubs := regionalHubsForCountry(country)
	if len(hubs) == 0 {
		return "", 0, 0, false
	}
	for _, hint := range []string{city, region} {
		if h, found := matchRegionalHubByText(hubs, hint); found {
			return h.Name, h.Lat, h.Lon, true
		}
	}
	if math.Abs(lat) > 0.01 || math.Abs(lon) > 0.01 {
		if h, found := nearestRegionalHub(hubs, lat, lon); found {
			return h.Name, h.Lat, h.Lon, true
		}
	}
	return "", 0, 0, false
}

// ApplyRegionalHubCoords returns hub city name and centroid when the country has regional hubs.
func ApplyRegionalHubCoords(country, city, region string, lat, lon float64) (outCity string, outLat, outLon float64, ok bool) {
	hubName, hLat, hLon, ok := ResolveRegionalHub(country, city, region, lat, lon)
	if !ok {
		return city, lat, lon, false
	}
	return hubName, hLat, hLon, true
}

func regionalHubsForCountry(country string) []regionalHub {
	cc := normalizeCountryKey(country)
	if cc == "" {
		return nil
	}
	return regionalHubsByCountry[cc]
}

func matchRegionalHubByText(hubs []regionalHub, raw string) (regionalHub, bool) {
	key := normalizePlaceKey(raw)
	if key == "" {
		return regionalHub{}, false
	}
	// Exact name/alias first, then longest substring match so "western north"
	// does not incorrectly hit Takoradi's shorter "western" alias.
	var best regionalHub
	bestScore := 0
	for _, h := range hubs {
		nameKey := normalizePlaceKey(h.Name)
		// Spacing-insensitive so typed names like "Capecoast" still hit "Cape Coast".
		if nameKey == key || compactPlaceKey(nameKey) == compactPlaceKey(key) {
			return h, true
		}
		if nameKey != "" && (strings.Contains(key, nameKey) || strings.Contains(nameKey, key)) {
			score := len(nameKey)
			if score > bestScore {
				best = h
				bestScore = score
			}
		}
		for _, alias := range h.Aliases {
			aliasKey := normalizePlaceKey(alias)
			if aliasKey == "" {
				continue
			}
			if aliasKey == key || compactPlaceKey(aliasKey) == compactPlaceKey(key) {
				return h, true
			}
			if strings.Contains(key, aliasKey) || strings.Contains(aliasKey, key) {
				score := len(aliasKey)
				if score > bestScore {
					best = h
					bestScore = score
				}
			}
		}
	}
	if bestScore > 0 {
		return best, true
	}
	return regionalHub{}, false
}

func nearestRegionalHub(hubs []regionalHub, lat, lon float64) (regionalHub, bool) {
	hub, distKm, ok := nearestRegionalHubWithDistance(hubs, lat, lon)
	if !ok || distKm > maxRegionalHubSnapKm {
		return regionalHub{}, false
	}
	return hub, true
}

func nearestRegionalHubWithDistance(hubs []regionalHub, lat, lon float64) (regionalHub, float64, bool) {
	if len(hubs) == 0 {
		return regionalHub{}, 0, false
	}
	best := hubs[0]
	bestDist := haversineKm(lat, lon, best.Lat, best.Lon)
	for _, h := range hubs[1:] {
		if d := haversineKm(lat, lon, h.Lat, h.Lon); d < bestDist {
			best = h
			bestDist = d
		}
	}
	return best, bestDist, true
}

func normalizePlaceKey(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "-", " ")
	for strings.Contains(s, "  ") {
		s = strings.ReplaceAll(s, "  ", " ")
	}
	return s
}

// compactPlaceKey drops spaces from a normalized key ("cape coast" → "capecoast").
func compactPlaceKey(key string) string {
	return strings.ReplaceAll(key, " ", "")
}

func haversineKm(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusKm = 6371.0
	rad := math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLon := (lon2 - lon1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * earthRadiusKm * math.Asin(math.Sqrt(a))
}
