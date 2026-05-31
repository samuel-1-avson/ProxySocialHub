package geo

import "strings"

// CountryCentroid returns a map pin fallback [lat, lon] for ISO or common country names.
func CountryCentroid(country string, index int) (lat, lon float64, ok bool) {
	key := strings.TrimSpace(country)
	if key == "" {
		return 0, 0, false
	}
	c, found := countryCoords[key]
	if !found {
		if len(key) == 2 {
			if c2, ok2 := countryCoords[strings.ToUpper(key)]; ok2 {
				c = c2
				found = true
			}
		}
	}
	if !found {
		return 0, 0, false
	}
	jitter := float64((index%7)-3) * 0.35
	jitterLon := float64((index%5)-2) * 0.45
	return c[0] + jitter, c[1] + jitterLon, true
}

// ApplyListingCoords uses explorer/gateway coords when present, else country centroid.
func ApplyListingCoords(lat, lon float64, country string, index int) (outLat, outLon float64, resolved bool) {
	if abs(lat) > 0.01 || abs(lon) > 0.01 {
		return lat, lon, true
	}
	if lat2, lon2, ok := CountryCentroid(country, index); ok {
		return lat2, lon2, true
	}
	return lat, lon, false
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
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
}
