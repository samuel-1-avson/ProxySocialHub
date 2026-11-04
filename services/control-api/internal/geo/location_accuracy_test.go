package geo

import "testing"

// Regression: with IP lookup off, a Ghana node without a city got the
// country-area pin (Ghana's centroid), and the next pass snapped that pin to
// the nearest hub and saved it as the node's city. Every such node became
// "Kumasi". A country-area pin must never resolve to a city hub.
func TestCountryAreaPinNeverSnapsToCityHub(t *testing.T) {
	for _, anchor := range []string{"", "node:a", "node:b", "node:9743a931", "node:284eb946", "seller:x"} {
		for _, cc := range []string{"GH", "US", "NG", "DE"} {
			lat, lon, ok := CountryCentroid(cc, anchor)
			if !ok {
				t.Fatalf("no centroid for %s", cc)
			}
			if !IsCountryAreaGuess(cc, lat, lon) {
				t.Fatalf("%s %q: centroid %v,%v not recognised as a country-area guess", cc, anchor, lat, lon)
			}
			if name, _, _, found := ResolveRegionalHub(cc, "", "", lat, lon); found {
				t.Fatalf("%s %q: country-area pin snapped to hub %q", cc, anchor, name)
			}
			if _, _, src := ApplyMapCoords(lat, lon, cc, "", "Unknown", anchor); src != "country_centroid" {
				t.Fatalf("%s %q: ApplyMapCoords source=%q, want country_centroid", cc, anchor, src)
			}
		}
	}
}

// No hub may sit inside its own country's guess box, or IsCountryAreaGuess
// would refuse a real hub pin.
func TestNoHubInsideCountryAreaGuessBox(t *testing.T) {
	for cc, hubs := range regionalHubsByCountry {
		for _, h := range hubs {
			if IsCountryAreaGuess(cc, h.Lat, h.Lon) {
				t.Fatalf("%s hub %s (%v,%v) is inside the country-area guess box", cc, h.Name, h.Lat, h.Lon)
			}
		}
	}
}

// Real coordinates (a fresh IP lookup) still snap to the nearest hub.
func TestEvidenceCoordinatesStillSnap(t *testing.T) {
	if name, _, _, ok := ResolveRegionalHub("GH", "", "", 6.72, -1.61); !ok || name != "Kumasi" {
		t.Fatalf("got %q ok=%v, want Kumasi", name, ok)
	}
	if name, _, _, ok := ResolveRegionalHub("GH", "", "", 7.33, -2.31); !ok || name != "Sunyani" {
		t.Fatalf("got %q ok=%v, want Sunyani", name, ok)
	}
}

// Every Ghana region resolves to its own capital, by region name as an IP
// lookup or a user would write it.
func TestGhanaRegionsResolveToTheirCapitals(t *testing.T) {
	cases := map[string]string{
		"Greater Accra Region": "Accra",
		"Ashanti Region":       "Kumasi",
		"Western Region":       "Takoradi",
		"Western North Region": "Bibiani",
		"Central Region":       "Cape Coast",
		"Northern Region":      "Tamale",
		"Eastern Region":       "Koforidua",
		"Volta Region":         "Ho",
		"Oti Region":           "Dambai",
		"Bono Region":          "Sunyani",
		"Brong-Ahafo":          "Sunyani",
		"Bono East Region":     "Techiman",
		"Ahafo Region":         "Goaso",
		"Upper East Region":    "Bolgatanga",
		"Upper West Region":    "Wa",
		"North East Region":    "Nalerigu",
		"Savannah Region":      "Damongo",
	}
	for region, want := range cases {
		if name, _, _, ok := ResolveRegionalHub("GH", "", region, 0, 0); !ok || name != want {
			t.Errorf("region %q: got %q ok=%v, want %s", region, name, ok, want)
		}
	}
}

// Whole-word matching: a short hub name must not match inside another word.
func TestHubTextMatchUsesWholeWords(t *testing.T) {
	// Kwadaso (a Kumasi suburb) and Awaso (Western North) contain "wa".
	for _, city := range []string{"Kwadaso", "Awaso", "Akwatia", "Hohoe Road Junction"} {
		if name, _, _, ok := ResolveRegionalHub("GH", city, "", 0, 0); ok && (name == "Wa" || name == "Ho") {
			t.Errorf("%q matched hub %q by a partial word", city, name)
		}
	}
	// "California" contains "or" (Oregon → Seattle); it must reach the
	// California hub through the "northern california" alias instead.
	if name, _, _, ok := ResolveRegionalHub("US", "", "California", 0, 0); !ok || name == "Seattle" {
		t.Errorf("California: got %q ok=%v", name, ok)
	}
	// Punctuation and extra words are fine.
	if name, _, _, ok := ResolveRegionalHub("GH", "Accra, Ghana", "", 0, 0); !ok || name != "Accra" {
		t.Errorf("Accra, Ghana: got %q ok=%v", name, ok)
	}
	if name, _, _, ok := ResolveRegionalHub("GH", "Wa", "", 0, 0); !ok || name != "Wa" {
		t.Errorf("Wa: got %q ok=%v", name, ok)
	}
}

// Ghana's "Wa" is not the US state alias "wa" (Seattle): it stays a Ghana city.
func TestSanitizeKeepsOwnCountryCityThatIsAForeignAlias(t *testing.T) {
	if _, city, _ := SanitizeMapPlace("GH", "Wa", ""); city != "Wa" {
		t.Fatalf("got city %q, want Wa", city)
	}
	lat, lon, src := ApplyMapCoords(0, 0, "GH", "Wa", "", "node:x")
	if src != "region_hub" || lat != 10.0601 || lon != -2.5099 {
		t.Fatalf("got %v,%v src=%q, want Wa hub", lat, lon, src)
	}
	// A foreign hub city on a Ghana node is still dropped.
	if _, city, _ := SanitizeMapPlace("GH", "Chicago", ""); city != "" {
		t.Fatalf("got city %q, want Chicago dropped", city)
	}
}

func TestNodeHubKeepsDeclaredCity(t *testing.T) {
	// A declared hub city wins over the region.
	if city, lat, _, ok := NodeHub("GH", "Bibiani", "Ashanti Region", 0, 0); !ok || city != "Bibiani" || lat != 6.4632 {
		t.Fatalf("got %q %v ok=%v, want Bibiani", city, lat, ok)
	}
	// A declared city that is not a hub keeps its name; the pin may use the
	// region's hub, but the city is not renamed.
	if city, lat, _, ok := NodeHub("GH", "Obuasi", "Ashanti Region", 0, 0); !ok || city != "Obuasi" || lat != 6.6885 {
		t.Fatalf("got %q %v ok=%v, want Obuasi pinned at the Kumasi hub", city, lat, ok)
	}
	// Without region or evidence there is no hub and the city stays.
	if city, _, _, ok := NodeHub("GH", "Obuasi", "Unknown", 0, 0); ok || city != "Obuasi" {
		t.Fatalf("got %q ok=%v, want Obuasi with no hub", city, ok)
	}
	// No declared city: evidence coordinates name the hub.
	if city, _, _, ok := NodeHub("GH", "", "", 9.41, -0.85); !ok || city != "Tamale" {
		t.Fatalf("got %q ok=%v, want Tamale", city, ok)
	}
	// No declared city and only a country-area pin: no hub, no invented city.
	lat, lon, _ := CountryCentroid("GH", "node:x")
	if city, _, _, ok := NodeHub("GH", "", "Unknown", lat, lon); ok || city != "" {
		t.Fatalf("got %q ok=%v, want no city from a country-area pin", city, ok)
	}
}
