package topology

import "math"

// LinkVisual styles an arc for globe rendering.
type LinkVisual struct {
	Color       string
	StrokeWidth float64
}

// VisualForLink maps latency and session count to arc color and width.
func VisualForLink(latencyMs int, activeSessions int) LinkVisual {
	color := "#22c55e"
	switch {
	case latencyMs > 200:
		color = "#ef4444"
	case latencyMs > 80:
		color = "#eab308"
	}

	width := 0.4 + math.Min(math.Log1p(float64(activeSessions))*0.35, 2.1)
	return LinkVisual{
		Color:       color,
		StrokeWidth: width,
	}
}
