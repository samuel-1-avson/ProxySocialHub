package geo

import (
	"math"
	"strings"
	"unicode"
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
	if (math.Abs(lat) > 0.01 || math.Abs(lon) > 0.01) && !IsCountryAreaGuess(country, lat, lon) {
		if h, found := nearestRegionalHub(hubs, lat, lon); found {
			return h.Name, h.Lat, h.Lon, true
		}
	}
	return "", 0, 0, false
}

// IsCountryAreaGuess reports whether lat/lon is the country-area pin that
// CountryCentroid hands out (centroid plus its small per-node offset). Such a
// pin says "somewhere in this country", so it must never be snapped to the
// nearest city hub: that turned every Ghana node without a city into
// "Kumasi" (the hub closest to Ghana's centroid) and saved it as if the owner
// had said so.
func IsCountryAreaGuess(country string, lat, lon float64) bool {
	c, ok := countryCoords[normalizeCountryKey(country)]
	if !ok {
		return false
	}
	// stableJitter offsets by at most 0.06 deg lat and 0.04 deg lon.
	return math.Abs(lat-c[0]) <= 0.065 && math.Abs(lon-c[1]) <= 0.045
}

// NodeHub picks the regional hub for a provider node's map pin and the city
// name to keep for it.
//
// A declared city that names a hub wins. Otherwise the region text, then
// evidence coordinates (a fresh IP lookup, never a stored pin) may choose the
// hub; when they do, a declared city is still kept as the node's city, so a
// typed "Obuasi" is not renamed to "Kumasi". A city that belongs to another
// country's hub catalog (classic: "Chicago" on a Ghana node) is dropped.
func NodeHub(country, city, region string, evidenceLat, evidenceLon float64) (outCity string, lat, lon float64, ok bool) {
	country, city, region = SanitizeMapPlace(country, city, region)
	if city != "" {
		if name, hLat, hLon, found := ResolveRegionalHub(country, city, "", 0, 0); found {
			return name, hLat, hLon, true
		}
	}
	name, hLat, hLon, found := ResolveRegionalHub(country, "", region, evidenceLat, evidenceLon)
	if !found {
		return city, 0, 0, false
	}
	if city != "" {
		return city, hLat, hLon, true
	}
	return name, hLat, hLon, true
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
	keyTokens := placeTokens(raw)
	if len(keyTokens) == 0 {
		return regionalHub{}, false
	}
	key := strings.Join(keyTokens, " ")
	// Exact name/alias first, then the longest whole-word match so "western
	// north" does not hit Takoradi's shorter "western" alias. Matching whole
	// words (not substrings) stops short names hiding inside other words:
	// "la" in "Cleveland", "or" in "California", "wa" in "Kwadaso".
	var best regionalHub
	bestScore := 0
	consider := func(h regionalHub, candidate string) bool {
		candTokens := placeTokens(candidate)
		if len(candTokens) == 0 {
			return false
		}
		cand := strings.Join(candTokens, " ")
		// Spacing-insensitive so typed names like "Capecoast" still hit "Cape Coast".
		if cand == key || compactPlaceKey(cand) == compactPlaceKey(key) {
			return true
		}
		if containsTokenRun(keyTokens, candTokens) || containsTokenRun(candTokens, keyTokens) {
			if score := len(cand); score > bestScore {
				best = h
				bestScore = score
			}
		}
		return false
	}
	for _, h := range hubs {
		if consider(h, h.Name) {
			return h, true
		}
		for _, alias := range h.Aliases {
			if consider(h, alias) {
				return h, true
			}
		}
	}
	if bestScore > 0 {
		return best, true
	}
	return regionalHub{}, false
}

// placeTokens lowercases a place name and splits it into words, treating
// spaces, hyphens and punctuation as separators ("Accra, Ghana" → accra ghana).
func placeTokens(s string) []string {
	return strings.FieldsFunc(strings.ToLower(strings.TrimSpace(s)), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
}

// containsTokenRun reports whether needle appears as consecutive whole words in hay.
func containsTokenRun(hay, needle []string) bool {
	if len(needle) == 0 || len(needle) > len(hay) {
		return false
	}
	for i := 0; i+len(needle) <= len(hay); i++ {
		match := true
		for j := range needle {
			if hay[i+j] != needle[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
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
