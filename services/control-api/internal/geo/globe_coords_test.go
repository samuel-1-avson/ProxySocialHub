package geo

import (
	"math"
	"testing"
)

func TestIsGlobeCoord(t *testing.T) {
	cases := []struct {
		lat, lon float64
		ok       bool
	}{
		{5.6, -0.19, true},
		{37.43, -78.66, true},
		{0, 0, false},
		{91, 0, false},
		{0, 181, false},
		{math.NaN(), 0, false},
	}
	for _, c := range cases {
		if got := IsGlobeCoord(c.lat, c.lon); got != c.ok {
			t.Fatalf("IsGlobeCoord(%v,%v)=%v want %v", c.lat, c.lon, got, c.ok)
		}
	}
}
