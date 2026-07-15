package geo

import (
	"math"
	"strings"
)

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
	for _, h := range hubs {
		if normalizePlaceKey(h.Name) == key {
			return h, true
		}
		for _, alias := range h.Aliases {
			if normalizePlaceKey(alias) == key || strings.Contains(key, normalizePlaceKey(alias)) || strings.Contains(normalizePlaceKey(alias), key) {
				return h, true
			}
		}
	}
	return regionalHub{}, false
}

func nearestRegionalHub(hubs []regionalHub, lat, lon float64) (regionalHub, bool) {
	if len(hubs) == 0 {
		return regionalHub{}, false
	}
	best := hubs[0]
	bestDist := haversineKm(lat, lon, best.Lat, best.Lon)
	for _, h := range hubs[1:] {
		if d := haversineKm(lat, lon, h.Lat, h.Lon); d < bestDist {
			best = h
			bestDist = d
		}
	}
	return best, true
}

func normalizePlaceKey(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "-", " ")
	for strings.Contains(s, "  ") {
		s = strings.ReplaceAll(s, "  ", " ")
	}
	return s
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
