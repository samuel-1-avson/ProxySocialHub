package geo

import "strings"

// ResolveNodeMapGeoSource labels explorer node coordinates after ApplyMapCoords.
func ResolveNodeMapGeoSource(country, city, region string, rawLat, rawLon float64, fallbackGeo string) string {
	if _, _, _, ok := ApplyRegionalHubCoords(country, city, region, 0, 0); ok {
		return "region_hub"
	}
	if fallbackGeo == "region_hub" {
		return "region_hub"
	}
	if fallbackGeo == "city_centroid" {
		return "city_centroid"
	}
	if fallbackGeo == "country_centroid" {
		return "country_centroid"
	}
	if HasValidCoords(rawLat, rawLon) {
		return "explorer"
	}
	if strings.TrimSpace(country) != "" {
		return "country_centroid"
	}
	if fallbackGeo != "" && fallbackGeo != "unknown" {
		return fallbackGeo
	}
	return "unknown"
}
