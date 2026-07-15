package topology

import (
	"fmt"
	"strings"

	geo "github.com/proxyhubb/control-api/internal/geo"
)

// RegionEndpoint is a hub-snapped map anchor for topology arcs.
type RegionEndpoint struct {
	ID    string
	Label string
	Lat   float64
	Lon   float64
	Kind  string
}

// ResolveRegionEndpoint maps location hints to a regional hub coordinate.
func ResolveRegionEndpoint(country, city, region string, lat, lon float64, anchor string) (RegionEndpoint, bool) {
	country = strings.TrimSpace(country)
	city = strings.TrimSpace(city)
	region = strings.TrimSpace(region)

	outLat, outLon, src := geo.ApplyMapCoords(lat, lon, country, city, anchor)
	if src == "unknown" {
		return RegionEndpoint{}, false
	}
	if !geo.IsGlobeCoord(outLat, outLon) {
		return RegionEndpoint{}, false
	}

	hubName, _, _, hubOK := geo.ResolveRegionalHub(country, city, region, lat, lon)
	id := regionKey(country, hubName, city, region)
	label := regionLabel(country, hubName, city, region)

	kind := "region"
	if hubOK && hubName != "" {
		kind = "hub"
	}

	return RegionEndpoint{
		ID:    id,
		Label: label,
		Lat:   outLat,
		Lon:   outLon,
		Kind:  kind,
	}, true
}

// ResolveTargetGeoEndpoint parses buyer target_geo (e.g. "US", "US:virginia") into a hub.
func ResolveTargetGeoEndpoint(targetGeo string, listingCountry string) (RegionEndpoint, bool) {
	targetGeo = strings.TrimSpace(targetGeo)
	country := strings.TrimSpace(listingCountry)
	city := ""
	region := ""

	if targetGeo != "" {
		if parts := strings.SplitN(targetGeo, ":", 2); len(parts) == 2 {
			country = strings.TrimSpace(parts[0])
			region = strings.TrimSpace(parts[1])
		} else if len(targetGeo) == 2 {
			country = strings.ToUpper(targetGeo)
		} else {
			region = targetGeo
			if country == "" {
				country = targetGeo
			}
		}
	}

	if country == "" {
		return RegionEndpoint{}, false
	}

	return ResolveRegionEndpoint(country, city, region, 0, 0, "target:"+country+":"+region)
}

func regionKey(country, hubName, city, region string) string {
	cc := strings.ToUpper(strings.TrimSpace(country))
	if hubName != "" {
		return cc + ":" + slugKey(hubName)
	}
	if city != "" {
		return cc + ":" + slugKey(city)
	}
	if region != "" {
		return cc + ":" + slugKey(region)
	}
	return cc
}

func regionLabel(country, hubName, city, region string) string {
	if hubName != "" {
		return fmt.Sprintf("%s, %s", hubName, strings.ToUpper(country))
	}
	if city != "" {
		return fmt.Sprintf("%s, %s", city, strings.ToUpper(country))
	}
	if region != "" {
		return fmt.Sprintf("%s, %s", region, strings.ToUpper(country))
	}
	return strings.ToUpper(country)
}

func slugKey(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	s = strings.ReplaceAll(s, " ", "-")
	return s
}

// LabelFromRegionID formats a stored region key for display (e.g. US:virginia → Virginia, US).
func LabelFromRegionID(id string) string {
	id = strings.TrimSpace(id)
	if id == "" {
		return ""
	}
	parts := strings.SplitN(id, ":", 2)
	if len(parts) == 1 {
		return strings.ToUpper(parts[0])
	}
	cc := strings.ToUpper(parts[0])
	place := titleWords(strings.ReplaceAll(parts[1], "-", " "))
	return fmt.Sprintf("%s, %s", place, cc)
}

func titleWords(s string) string {
	words := strings.Fields(strings.TrimSpace(s))
	for i, w := range words {
		if w == "" {
			continue
		}
		words[i] = strings.ToUpper(w[:1]) + strings.ToLower(w[1:])
	}
	return strings.Join(words, " ")
}

func mathAbs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}
