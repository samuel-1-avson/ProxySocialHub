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

func TestExpandBBox(t *testing.T) {
	w, s, e, n := ExpandBBox(-10, 10, 10, 20, 2.5)
	if w != -12.5 || s != 7.5 || e != 12.5 || n != 22.5 {
		t.Fatalf("unexpected expand: %v %v %v %v", w, s, e, n)
	}
	_, s2, _, n2 := ExpandBBox(-10, -89, 10, 89, 5)
	if s2 != -90 || n2 != 90 {
		t.Fatalf("expected clamp to poles: %v %v", s2, n2)
	}
}

func TestQuantizeBBox(t *testing.T) {
	w, s, e, n := QuantizeBBox(-10.3, 20.1, -9.7, 21.4, 0.5)
	if w != -10.5 || s != 20.0 || e != -9.5 || n != 21.5 {
		t.Fatalf("unexpected quantize: %v %v %v %v", w, s, e, n)
	}
}
