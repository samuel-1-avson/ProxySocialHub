package geo

import (
	"hash/fnv"
	"strings"
)

// CityCentroid returns coordinates for a known city name (optionally scoped by country).
func CityCentroid(city, country string) (lat, lon float64, ok bool) {
	key := strings.ToLower(strings.TrimSpace(city))
	if key == "" {
		return 0, 0, false
	}
	if c, found := cityCoords[key]; found {
		return c[0], c[1], true
	}
	cc := strings.ToUpper(strings.TrimSpace(country))
	if cc != "" {
		if c, found := cityCoords[cc+":"+key]; found {
			return c[0], c[1], true
		}
	}
	return 0, 0, false
}

// CountryCentroid returns a stable map pin for a country. The anchor (node_id, seller_id, etc.)
// ensures listings on the same node share one location instead of being spread by row index.
func CountryCentroid(country, anchor string) (lat, lon float64, ok bool) {
	key := strings.TrimSpace(country)
	if key == "" {
		return 0, 0, false
	}
	c, found := countryCoords[key]
	if !found && len(key) == 2 {
		c, found = countryCoords[strings.ToUpper(key)]
	}
	if !found {
		return 0, 0, false
	}
	jitter, jitterLon := stableJitter(anchor)
	return c[0] + jitter, c[1] + jitterLon, true
}

// ApplyListingCoords uses GPS/explorer coords when present, else city centroid, else country centroid.
func ApplyListingCoords(lat, lon float64, country, city, anchor string) (outLat, outLon float64, resolved bool) {
	outLat, outLon, src := ApplyMapCoords(lat, lon, country, city, "", anchor)
	return outLat, outLon, src != "unknown"
}

// ApplyMapCoords resolves map coordinates and reports how they were derived.
// Pins use regional hubs (major city areas) when configured for the country.
// region is used when city is empty/wrong (e.g. "Western North" → Bibiani).
func ApplyMapCoords(lat, lon float64, country, city, region, anchor string) (outLat, outLon float64, geoSource string) {
	country, city, region = SanitizeMapPlace(country, city, region)
	if _, hLat, hLon, ok := ApplyRegionalHubCoords(country, city, region, lat, lon); ok {
		return hLat, hLon, "region_hub"
	}
	if lat2, lon2, ok := CityCentroid(city, country); ok {
		return lat2, lon2, "city_centroid"
	}
	if lat2, lon2, ok := CountryCentroid(country, anchor); ok {
		return lat2, lon2, "country_centroid"
	}
	return lat, lon, "unknown"
}

// SanitizeMapPlace drops a city that belongs to another country's hub catalog
// (classic failure: explorer city "Chicago" with provider country "GH").
func SanitizeMapPlace(country, city, region string) (string, string, string) {
	country = NormalizeCountryCode(strings.TrimSpace(country))
	city = strings.TrimSpace(city)
	region = strings.TrimSpace(region)
	if country == "" || city == "" {
		return country, city, region
	}
	if cityBelongsToOtherCountry(country, city) {
		city = ""
	}
	return country, city, region
}

func cityBelongsToOtherCountry(country, city string) bool {
	for otherCC, hubs := range regionalHubsByCountry {
		if otherCC == country {
			continue
		}
		if h, ok := matchRegionalHubByText(hubs, city); ok {
			if normalizePlaceKey(h.Name) == normalizePlaceKey(city) {
				return true
			}
			for _, alias := range h.Aliases {
				if normalizePlaceKey(alias) == normalizePlaceKey(city) {
					return true
				}
			}
		}
	}
	return false
}

// MapGeoAnchor picks a stable grouping key so co-located listings share coordinates.
func MapGeoAnchor(nodeID, sellerID, listingID string) string {
	if id := strings.TrimSpace(nodeID); id != "" {
		return "node:" + id
	}
	if id := strings.TrimSpace(sellerID); id != "" {
		return "seller:" + id
	}
	return "listing:" + strings.TrimSpace(listingID)
}

func stableJitter(anchor string) (lat, lon float64) {
	anchor = strings.TrimSpace(anchor)
	if anchor == "" {
		return 0, 0
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(anchor))
	v := h.Sum32()
	// ~±0.06° (~7 km) separates different nodes in the same country; identical anchor = identical pin.
	lat = float64(int(v%7)-3) * 0.02
	lon = float64(int((v>>4)%5)-2) * 0.02
	return lat, lon
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

// HasValidCoords reports whether lat/lon are non-trivial map coordinates.
func HasValidCoords(lat, lon float64) bool {
	return abs(lat) > 0.01 || abs(lon) > 0.01
}

var cityCoords = map[string][2]float64{
	"accra":      {5.6037, -0.1870},
	"kumasi":     {6.6885, -1.6244},
	"tamale":     {9.4035, -0.8429},
	"tema":       {5.6698, -0.0166},
	"cape coast": {5.1053, -1.2466},
	"takoradi":   {4.8845, -1.7554},
	"gh:accra":   {5.6037, -0.1870},
	"gh:kumasi":  {6.6885, -1.6244},
	"gh:takoradi": {4.8845, -1.7554},
	"new york":   {40.7128, -74.0060},
	"london":     {51.5074, -0.1278},
	"paris":      {48.8566, 2.3522},
	"berlin":     {52.5200, 13.4050},
	"amsterdam":  {52.3676, 4.9041},
	"singapore":  {1.3521, 103.8198},
	"tokyo":      {35.6762, 139.6503},
	"los angeles": {34.0522, -118.2437},
}

var countryCoords = map[string][2]float64{
	"US":              {38, -97},
	"United States":   {38, -97},
	"USA":             {38, -97},
	"CA":              {56, -106},
	"Canada":          {56, -106},
	"MX":              {23, -102},
	"Mexico":          {23, -102},
	"GB":              {52, -1},
	"United Kingdom":  {52, -1},
	"UK":              {52, -1},
	"DE":              {51, 10},
	"Germany":         {51, 10},
	"FR":              {46, 2},
	"France":          {46, 2},
	"NL":              {52, 5},
	"Netherlands":     {52, 5},
	"SE":              {60, 15},
	"Sweden":          {60, 15},
	"NO":              {64, 15},
	"Norway":          {64, 15},
	"FI":              {64, 26},
	"Finland":         {64, 26},
	"CH":              {47, 8},
	"Switzerland":     {47, 8},
	"PL":              {52, 20},
	"Poland":          {52, 20},
	"UA":              {49, 32},
	"Ukraine":         {49, 32},
	"TR":              {39, 35},
	"Turkey":          {39, 35},
	"ES":              {40, -4},
	"Spain":           {40, -4},
	"IT":              {42, 12},
	"Italy":           {42, 12},
	"PT":              {39, -8},
	"Portugal":        {39, -8},
	"RO":              {45, 25},
	"Romania":         {45, 25},
	"JP":              {35, 135},
	"Japan":           {35, 135},
	"SG":              {1, 104},
	"Singapore":       {1, 104},
	"HK":              {22, 114},
	"Hong Kong":       {22, 114},
	"KR":              {37, 127},
	"South Korea":     {37, 127},
	"IN":              {20, 77},
	"India":           {20, 77},
	"CN":              {35, 103},
	"China":           {35, 103},
	"AU":              {-25, 133},
	"Australia":       {-25, 133},
	"BR":              {-10, -55},
	"Brazil":          {-10, -55},
	"ZA":              {-29, 25},
	"South Africa":    {-29, 25},
	"AE":              {24, 54},
	"UAE":             {24, 54},
	"GH":              {7.9, -1.0},
	"Ghana":           {7.9, -1.0},
	"NG":              {9, 8},
	"Nigeria":         {9, 8},
}
