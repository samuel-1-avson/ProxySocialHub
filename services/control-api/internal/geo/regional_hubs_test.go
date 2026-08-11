package geo

import "testing"

func TestResolveRegionalHubGhanaByCityName(t *testing.T) {
	name, lat, lon, ok := ResolveRegionalHub("GH", "Kumasi", "", 0, 0)
	if !ok || name != "Kumasi" || lat != 6.6885 {
		t.Fatalf("got %q %v %v ok=%v", name, lat, lon, ok)
	}
}

func TestResolveRegionalHubGhanaBibiani(t *testing.T) {
	name, lat, lon, ok := ResolveRegionalHub("GH", "Bibiani", "Western North", 0, 0)
	if !ok || name != "Bibiani" || lat != 6.4632 || lon != -2.3192 {
		t.Fatalf("got %q %v %v ok=%v, want Bibiani", name, lat, lon, ok)
	}
	name, _, _, ok = ResolveRegionalHub("GH", "", "western north region", 0, 0)
	if !ok || name != "Bibiani" {
		t.Fatalf("got %q ok=%v, want Bibiani from western north alias", name, ok)
	}
}

func TestResolveRegionalHubGhanaTakoradiAlias(t *testing.T) {
	name, _, _, ok := ResolveRegionalHub("Ghana", "Sekondi-Takoradi", "", 0, 0)
	if !ok || name != "Takoradi" {
		t.Fatalf("got %q ok=%v, want Takoradi", name, ok)
	}
}

func TestResolveRegionalHubGhanaNearestFromCoords(t *testing.T) {
	// Near Kumasi (~6.7, -1.6)
	name, lat, _, ok := ResolveRegionalHub("GH", "", "", 6.72, -1.61)
	if !ok || name != "Kumasi" || lat != 6.6885 {
		t.Fatalf("got %q %v ok=%v, want Kumasi", name, lat, ok)
	}
}

func TestResolveRegionalHubGhanaAccraMetro(t *testing.T) {
	name, _, _, ok := ResolveRegionalHub("GH", "Tema", "", 0, 0)
	if !ok || name != "Accra" {
		t.Fatalf("got %q ok=%v, want Accra hub for Tema", name, ok)
	}
}

func TestApplyMapCoordsUsesRegionalHub(t *testing.T) {
	lat, lon, src := ApplyMapCoords(6.72, -1.61, "GH", "", "", "node:test")
	if src != "region_hub" || lat != 6.6885 {
		t.Fatalf("got lat=%v lon=%v src=%q, want Kumasi region_hub", lat, lon, src)
	}
}

func TestResolveRegionalHubUSNewYork(t *testing.T) {
	name, lat, _, ok := ResolveRegionalHub("US", "Brooklyn", "", 40.65, -73.95)
	if !ok || name != "New York" || lat != 40.7128 {
		t.Fatalf("got %q %v ok=%v, want New York", name, lat, ok)
	}
}

func TestResolveRegionalHubUSBayAreaNearest(t *testing.T) {
	name, _, _, ok := ResolveRegionalHub("USA", "", "", 37.4, -122.1)
	if !ok || name != "San Francisco" {
		t.Fatalf("got %q ok=%v, want San Francisco for Bay Area coords", name, ok)
	}
}

func TestResolveRegionalHubNigeriaLagos(t *testing.T) {
	name, _, _, ok := ResolveRegionalHub("Nigeria", "Lagos", "Lagos State", 0, 0)
	if !ok || name != "Lagos" {
		t.Fatalf("got %q ok=%v, want Lagos", name, ok)
	}
}

func TestResolveRegionalHubChinaShanghai(t *testing.T) {
	name, _, _, ok := ResolveRegionalHub("CN", "Shanghai", "", 0, 0)
	if !ok || name != "Shanghai" {
		t.Fatalf("got %q ok=%v, want Shanghai", name, ok)
	}
}

func TestResolveRegionalHubGermanyBerlin(t *testing.T) {
	name, _, _, ok := ResolveRegionalHub("DE", "Berlin", "", 0, 0)
	if !ok || name != "Berlin" {
		t.Fatalf("got %q ok=%v, want Berlin", name, ok)
	}
}

func TestResolveRegionalHubUnsupportedCountry(t *testing.T) {
	_, _, _, ok := ResolveRegionalHub("Maldives", "Malé", "", 4.17, 73.5)
	if ok {
		t.Fatal("expected no regional hub for Maldives")
	}
}

func TestRegionalHubsByCountryHasMajorMarkets(t *testing.T) {
	for _, cc := range []string{"US", "NG", "CN", "GB", "DE", "FR", "GH", "IN", "JP", "BR"} {
		if len(regionalHubsByCountry[cc]) == 0 {
			t.Fatalf("expected regional hubs for %s", cc)
		}
	}
}
