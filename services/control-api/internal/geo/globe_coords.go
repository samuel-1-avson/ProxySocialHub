package geo

import "math"

// IsGlobeCoord reports whether lat/lon are finite WGS84 coordinates safe for map/globe renderers (incl. H3).
func IsGlobeCoord(lat, lon float64) bool {
	if math.IsNaN(lat) || math.IsNaN(lon) || math.IsInf(lat, 0) || math.IsInf(lon, 0) {
		return false
	}
	if math.Abs(lat) > 90 || math.Abs(lon) > 180 {
		return false
	}
	if abs(lat) < 0.01 && abs(lon) < 0.01 {
		return false
	}
	return true
}
