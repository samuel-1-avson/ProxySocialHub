package discovery

import (
	"strings"
	"testing"

	"github.com/proxyhubb/control-api/internal/models"
)

func TestNeedsServiceConfigJoin(t *testing.T) {
	if (Query{Country: "US"}).NeedsServiceConfigJoin() {
		t.Fatal("country alone should not require service config join")
	}
	if !(Query{Protocols: []string{"socks5"}}).NeedsServiceConfigJoin() {
		t.Fatal("protocols should require service config join")
	}
	if !(Query{MinBandwidthMbps: 50}).NeedsServiceConfigJoin() {
		t.Fatal("bandwidth should require service config join")
	}
}

func TestFromServiceFilterMapsPriceAndQuality(t *testing.T) {
	q := FromServiceFilter(models.ServiceFilter{
		MaxPricePerGB:   2.5,
		MinQualityScore: 80,
		TargetCountries: []string{"US", "DE"},
		Page:            1,
		Limit:           10,
	})
	if !q.MaxPriceSet || q.MaxPrice != 2.5 {
		t.Fatalf("expected max price 2.5, got %+v", q)
	}
	if !q.MinQualitySet || q.MinQualityScore != 80 {
		t.Fatalf("expected min quality 80, got %+v", q)
	}
	if len(q.TargetCountries) != 2 {
		t.Fatalf("expected 2 countries, got %v", q.TargetCountries)
	}
}

func TestServiceConfigJoinUsesProviderNodePath(t *testing.T) {
	if !strings.Contains(nodesJoinClause, "provider_node_id") {
		t.Fatalf("nodes join must link via provider_node_id: %s", nodesJoinClause)
	}
	if strings.Contains(serviceConfigJoinClause, "proxy_listings.id") {
		t.Fatalf("service config join must not reference listing id: %s", serviceConfigJoinClause)
	}
	if !strings.Contains(serviceConfigJoinClause, "sc.node_id = n.id") {
		t.Fatalf("service config join must use gateway node id: %s", serviceConfigJoinClause)
	}
}

func TestFromListingFilterMapProtocols(t *testing.T) {
	q := FromListingFilterMap(map[string]interface{}{
		"protocols": []string{"http", "socks5"},
		"page":      1,
		"limit":     20,
	})
	if len(q.Protocols) != 2 {
		t.Fatalf("expected 2 protocols, got %v", q.Protocols)
	}
	if !q.NeedsServiceConfigJoin() {
		t.Fatal("protocols filter should require service config join")
	}
}
