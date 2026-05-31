package geo

import "testing"

func TestPinInBBox(t *testing.T) {
	if !PinInBBox(40.7, -74.0, -80, 35, -70, 45) {
		t.Fatal("NYC should be inside bbox")
	}
	if PinInBBox(51.5, -0.1, -80, 35, -70, 45) {
		t.Fatal("London should be outside NYC bbox")
	}
}
