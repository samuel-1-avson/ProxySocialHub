package topology

import "testing"

func TestVisualForLink_LatencyColors(t *testing.T) {
	green := VisualForLink(50, 1)
	if green.Color != "#22c55e" {
		t.Fatalf("expected green, got %s", green.Color)
	}
	yellow := VisualForLink(120, 1)
	if yellow.Color != "#eab308" {
		t.Fatalf("expected yellow, got %s", yellow.Color)
	}
	red := VisualForLink(250, 1)
	if red.Color != "#ef4444" {
		t.Fatalf("expected red, got %s", red.Color)
	}
}

func TestVisualForLink_StrokeWidthScales(t *testing.T) {
	low := VisualForLink(50, 1)
	high := VisualForLink(50, 100)
	if high.StrokeWidth <= low.StrokeWidth {
		t.Fatalf("expected wider stroke for more sessions: low=%v high=%v", low.StrokeWidth, high.StrokeWidth)
	}
}
