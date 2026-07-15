package indexer

import "testing"

func TestGetCountryFromRegionReturnsISO2(t *testing.T) {
	ns := &NodeSync{}
	cases := map[string]string{
		"us-east":      "US",
		"eu-west":      "IE",
		"ap-southeast": "SG",
		"af-south":     "ZA",
		"Ghana":        "GH",
		"unknown":      "",
	}
	for region, want := range cases {
		if got := ns.getCountryFromRegion(region); got != want {
			t.Fatalf("getCountryFromRegion(%q)=%q want %q", region, got, want)
		}
	}
}
