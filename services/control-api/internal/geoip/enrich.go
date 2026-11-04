package geoip

import (
	"log"
	"math"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/geo"
	"github.com/proxyhubb/control-api/internal/models"
)

// EnrichExplorerForProviderNode normalizes the provider node's IP/location and writes
// coordinates to explorer_nodes when GeoIP or city centroids apply.
func EnrichExplorerForProviderNode(providerNodeID string) bool {
	return enrichExplorerForProviderNode(providerNodeID, false)
}

// ForceEnrichExplorerForProviderNode re-resolves coordinates even when sticky
// (non-zero) lat/lon already exist — used after IP/country corrections.
func ForceEnrichExplorerForProviderNode(providerNodeID string) bool {
	return enrichExplorerForProviderNode(providerNodeID, true)
}

func enrichExplorerForProviderNode(providerNodeID string, force bool) bool {
	if db.DB == nil || providerNodeID == "" {
		return false
	}

	var node models.ProviderNode
	if err := db.DB.Where("id = ?", providerNodeID).First(&node).Error; err != nil {
		return false
	}

	listingCountry := ""
	_ = db.DB.Table("proxy_listings").
		Where("provider_node_id = ?", node.ID).
		Where("country IS NOT NULL AND country <> ''").
		Limit(1).
		Pluck("country", &listingCountry).Error

	// Never substitute the control-api WAN for private peer IPs.
	rawIP := NormalizeIPForGeo(node.IPAddress)
	effectiveIP := PublicIPForGeo(rawIP)
	if IsControlPlanePublicIP(effectiveIP) {
		effectiveIP = ""
	}
	country, city := geo.NormalizeProviderLocation(
		firstNonEmptyStr(node.Country, listingCountry),
		node.City,
	)

	providerUpdates := map[string]interface{}{}
	// Scrub a previously persisted control-plane WAN IP so it cannot keep
	// re-geolocating the node to Chicago on every enrich pass.
	if IsControlPlanePublicIP(rawIP) {
		providerUpdates["ip_address"] = nil
		node.IPAddress = ""
	}
	if country != "" && country != node.Country {
		providerUpdates["country"] = country
		node.Country = country
	}
	if city != "" && city != node.City {
		providerUpdates["city"] = city
		node.City = city
	}

	var explorer models.ExplorerNode
	if err := db.DB.Where("node_id = ?", providerNodeID).First(&explorer).Error; err != nil {
		if len(providerUpdates) > 0 {
			if err := db.DB.Model(&node).Updates(providerUpdates).Error; err != nil {
				log.Printf("[GeoIP] provider node update %s: %v", providerNodeID, err)
			}
		}
		return false
	}

	updates := map[string]interface{}{}
	if effectiveIP != "" && effectiveIP != explorer.IP {
		updates["ip"] = effectiveIP
	}
	if IsControlPlanePublicIP(explorer.IP) || (explorer.IP != "" && effectiveIP == "" && IsControlPlanePublicIP(rawIP)) {
		updates["ip"] = ""
	}
	if IsCloudHostedISP(explorer.ISP) && country != "" {
		updates["isp"] = ""
	}
	effectiveISP := firstNonEmptyStr(node.ISP, explorer.ISP)
	if country != "" && (explorer.Country == "" || explorer.Country == "unknown" || force ||
		(geo.NormalizeCountryCode(explorer.Country) != "" && geo.NormalizeCountryCode(explorer.Country) != country)) {
		updates["country"] = country
	}
	if effectiveISP != "" && explorer.ISP == "" {
		updates["isp"] = effectiveISP
	}
	if effectiveISP != "" && node.ISP == "" {
		providerUpdates["isp"] = effectiveISP
		node.ISP = effectiveISP
	}

	regionHint := explorer.Region
	lat, lon := explorer.Latitude, explorer.Longitude
	explorerCountry := geo.NormalizeCountryCode(explorer.Country)
	countryMismatch := country != "" && explorerCountry != "" && explorerCountry != country
	needsIPResolve := force || countryMismatch || (math.Abs(lat) < 0.01 && math.Abs(lon) < 0.01)
	ipResolved := false
	if needsIPResolve && effectiveIP != "" {
		if result, ok := Resolve(effectiveIP); ok {
			// Cloud/control-plane WAN (e.g. Google Cloud → Chicago) must not
			// override a declared residential provider location.
			if IsCloudHostedISP(result.ISP) && country != "" {
				lat, lon = 0, 0
			} else {
				ipResolved = true
				lat, lon = result.Latitude, result.Longitude
				ipCountry := normalizeCountryCode(result.Country)
				if result.ISP != "" && !IsCloudHostedISP(result.ISP) {
					updates["isp"] = result.ISP
					effectiveISP = result.ISP
					if result.ISP != node.ISP {
						providerUpdates["isp"] = result.ISP
						node.ISP = result.ISP
					}
				}
				if ipCountry != "" && country == "" {
					updates["country"] = ipCountry
					country = ipCountry
					if country != node.Country {
						providerUpdates["country"] = country
						node.Country = country
					}
				} else if country != "" && ipCountry != "" && ipCountry != country {
					lat, lon = 0, 0
				}
				// Never let IP region overwrite a declared provider region
				// (Western North must not become Greater Accra).
				if result.Region != "" && node.Region == "" && explorer.Region == "" && !node.LocationUserSet &&
					(country == "" || ipCountry == "" || ipCountry == country) {
					regionHint = result.Region
					updates["region"] = result.Region
					providerUpdates["region"] = result.Region
					node.Region = result.Region
				}
			}
		}
	}
	// Explicit country/city wins for map hubs (e.g. Ghana Bibiani) even when IP geo failed
	// or previously stuck on a wrong US hub.
	if country != "" {
		updates["country"] = country
	}
	// Declared city/region (Bibiani / Western North) must beat IP-city snaps
	// (Ghana mobile egress often geolocates to Accra). Only a fresh IP result
	// counts as coordinate evidence: the stored pin may be a country-area
	// guess or an old hub, and snapping it again is how every Ghana node
	// without a city was saved as "Kumasi".
	coordsFromIP := ipResolved && (math.Abs(lat) > 0.01 || math.Abs(lon) > 0.01)
	evidenceLat, evidenceLon := 0.0, 0.0
	if coordsFromIP {
		evidenceLat, evidenceLon = lat, lon
	}
	hubCity, hubLat, hubLon, hubOK := geo.NodeHub(
		country,
		firstNonEmptyStr(city, node.City),
		firstNonEmptyStr(node.Region, regionHint),
		evidenceLat,
		evidenceLon,
	)
	city = hubCity
	switch {
	case hubOK:
		lat, lon = hubLat, hubLon
	case coordsFromIP:
		// No hub for these coordinates: keep the IP position; the public map
		// resolves it to a city or country area at read time.
	default:
		lat, lon = 0, 0
		if clat, clon, ok := geo.CityCentroid(city, country); ok {
			lat, lon = clat, clon
		} else if clat, clon, ok := geo.CountryCentroid(country, providerNodeID); ok {
			lat, lon = clat, clon
		}
	}
	// The explorer row mirrors the node's city, including clearing one that
	// was never the owner's (an old snap or a city from another country).
	if city != explorer.City {
		updates["city"] = city
	} else {
		delete(updates, "city")
	}
	if city != "" && city != node.City {
		providerUpdates["city"] = city
		node.City = city
	}
	if math.Abs(lat) > 0.01 || math.Abs(lon) > 0.01 {
		updates["latitude"] = lat
		updates["longitude"] = lon
	}

	effectiveCountry := explorer.Country
	if v, ok := updates["country"].(string); ok && v != "" {
		effectiveCountry = v
	} else if country != "" {
		effectiveCountry = country
	}
	effectiveCity := city
	anchor := geo.MapGeoAnchor(providerNodeID, "", "")
	_, _, fallbackGeo := geo.ApplyMapCoords(lat, lon, effectiveCountry, effectiveCity, regionHint, anchor)
	geoSource := geo.ResolveNodeMapGeoSource(
		effectiveCountry,
		effectiveCity,
		regionHint,
		explorer.Latitude,
		explorer.Longitude,
		fallbackGeo,
	)
	if geoSource != "" {
		updates["geo_source"] = geoSource
		now := time.Now().UTC()
		updates["geo_resolved_at"] = &now
	}

	if len(providerUpdates) > 0 {
		if err := db.DB.Model(&node).Updates(providerUpdates).Error; err != nil {
			log.Printf("[GeoIP] provider node update %s: %v", providerNodeID, err)
		}
	}
	syncProviderNodeListings(node, country, effectiveISP)

	if len(updates) == 0 {
		return false
	}
	if err := db.DB.Model(&explorer).Updates(updates).Error; err != nil {
		log.Printf("[GeoIP] explorer enrich %s: %v", providerNodeID, err)
		return false
	}
	return true
}

func syncProviderNodeListings(node models.ProviderNode, country, isp string) {
	if node.ID.String() == "" {
		return
	}

	if country != "" {
		if err := db.DB.Model(&models.ProxyListing{}).
			Where("provider_node_id = ?", node.ID).
			// A listing's country is the node's exit country; a stale value
			// captured at creation must not outlive an owner-set correction;
			// (a stale "US" once pinned a Ghana node to Boston).
			Where("(country IS NULL OR country = '' OR country = 'verify-smoke') OR (? AND country <> ?)", node.LocationUserSet, country).
			Update("country", country).Error; err != nil {
			log.Printf("[GeoIP] provider listing country sync %s: %v", node.ID.String(), err)
		}
	}
	if isp != "" {
		if err := db.DB.Model(&models.ProxyListing{}).
			Where("provider_node_id = ?", node.ID).
			Where("isp IS NULL OR isp = ''").
			Update("isp", isp).Error; err != nil {
			log.Printf("[GeoIP] provider listing isp sync %s: %v", node.ID.String(), err)
		}
	}
}

// BackfillAllProviderNodes re-runs geo enrichment for every provider node (dev/recovery).
func BackfillAllProviderNodes() int {
	if db.DB == nil {
		return 0
	}
	var ids []string
	if err := db.DB.Model(&models.ProviderNode{}).Pluck("id", &ids).Error; err != nil {
		return 0
	}
	updated := 0
	for _, id := range ids {
		if ForceEnrichExplorerForProviderNode(id) {
			updated++
		}
	}
	return updated
}

func firstNonEmptyStr(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
