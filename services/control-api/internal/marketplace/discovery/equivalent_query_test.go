package discovery

import (
	"testing"

	"github.com/proxyhubb/control-api/internal/models"
)

// TestEquivalentFiltersAlign ensures legacy /v1/services and canonical /v1/listings
// map overlapping query parameters to the same discovery.Query shape.
func TestEquivalentFiltersAlign(t *testing.T) {
	svc := FromServiceFilter(models.ServiceFilter{
		TargetCountries: []string{"US"},
		MinQualityScore: 80,
		MaxPricePerGB:   4.5,
		Protocols:       []string{"http", "socks5"},
		Page:            0,
		Limit:           50,
	})
	list := FromListingFilterMap(map[string]interface{}{
		"country":           "US",
		"min_quality_score": 80.0,
		"max_price":         4.5,
		"protocols":         []string{"http", "socks5"},
		"page":              1,
		"limit":             50,
	})

	if svc.Country != "US" && len(svc.TargetCountries) != 1 {
		t.Fatalf("service filter country: %+v", svc)
	}
	if list.Country != "US" {
		t.Fatalf("listing filter country: %s", list.Country)
	}
	if !svc.MinQualitySet || svc.MinQualityScore != 80 || !list.MinQualitySet || list.MinQualityScore != 80 {
		t.Fatalf("quality mismatch svc=%+v list=%+v", svc, list)
	}
	if !svc.MaxPriceSet || svc.MaxPrice != 4.5 || !list.MaxPriceSet || list.MaxPrice != 4.5 {
		t.Fatalf("price mismatch svc=%+v list=%+v", svc, list)
	}
	if len(svc.Protocols) != 2 || len(list.Protocols) != 2 {
		t.Fatalf("protocols mismatch svc=%v list=%v", svc.Protocols, list.Protocols)
	}
	if !svc.NeedsServiceConfigJoin() || !list.NeedsServiceConfigJoin() {
		t.Fatal("protocol filters must require service config join on both paths")
	}
}
