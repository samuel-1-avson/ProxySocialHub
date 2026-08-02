package geo

import "math"

// PinInBBox reports whether a point lies inside west,south,east,north (inclusive).
func PinInBBox(lat, lon, west, south, east, north float64) bool {
	return lon >= west && lon <= east && lat >= south && lat <= north
}

// ExpandBBox grows a bbox by padDegrees on each side (clamped to world bounds).
// Used as a SQL prefilter before hub/centroid snapping.
func ExpandBBox(west, south, east, north, padDegrees float64) (w, s, e, n float64) {
	w = west - padDegrees
	s = south - padDegrees
	e = east + padDegrees
	n = north + padDegrees
	if s < -90 {
		s = -90
	}
	if n > 90 {
		n = 90
	}
	if w < -180 {
		w = -180
	}
	if e > 180 {
		e = 180
	}
	return w, s, e, n
}

// QuantizeBBox rounds bbox edges to the given step (degrees) for Redis cache keys.
func QuantizeBBox(west, south, east, north, step float64) (w, s, e, n float64) {
	if step <= 0 {
		step = 0.5
	}
	return math.Floor(west/step) * step,
		math.Floor(south/step) * step,
		math.Ceil(east/step) * step,
		math.Ceil(north/step) * step
}
