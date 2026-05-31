package geo

// PinInBBox reports whether a point lies inside west,south,east,north (inclusive).
func PinInBBox(lat, lon, west, south, east, north float64) bool {
	return lon >= west && lon <= east && lat >= south && lat <= north
}
