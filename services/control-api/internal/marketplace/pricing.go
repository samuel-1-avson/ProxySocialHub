package marketplace

import (
	"context"
	"fmt"

	"github.com/proxyhubb/control-api/internal/prices"
)

// RequiredSOLForUSD converts a USD-denominated total into SOL using the live price feed.
func RequiredSOLForUSD(ctx context.Context, totalUSD float64) (float64, error) {
	if totalUSD <= 0 {
		return 0, fmt.Errorf("invalid order total")
	}
	solPrice, err := prices.GetSOLPrice(ctx)
	if err != nil {
		return 0, err
	}
	if solPrice <= 0 {
		return 0, fmt.Errorf("invalid SOL price from feed")
	}
	return totalUSD / solPrice, nil
}
