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

	effectiveIP := NormalizeIPForGeo(node.IPAddress)
	country, city := geo.NormalizeProviderLocation(
		firstNonEmptyStr(node.Country, listingCountry),
		node.City,
	)

	providerUpdates := map[string]interface{}{}
	if effectiveIP != "" && effectiveIP != node.IPAddress {
		providerUpdates["ip_address"] = effectiveIP
		node.IPAddress = effectiveIP
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
	effectiveISP := firstNonEmptyStr(node.ISP, explorer.ISP)
	if country != "" && (explorer.Country == "" || explorer.Country == "unknown") {
		updates["country"] = country
	}
	if city != "" && (explorer.City == "" || explorer.City == "Unknown") {
		updates["city"] = city
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
	ipCity := ""
	if math.Abs(lat) < 0.01 && math.Abs(lon) < 0.01 && effectiveIP != "" {
		if result, ok := Resolve(effectiveIP); ok {
			lat, lon = result.Latitude, result.Longitude
			ipCity = result.City
			if result.ISP != "" {
				updates["isp"] = result.ISP
				effectiveISP = result.ISP
				if result.ISP != node.ISP {
					providerUpdates["isp"] = result.ISP
					node.ISP = result.ISP
				}
			}
			if countryCode := normalizeCountryCode(result.Country); countryCode != "" {
				updates["country"] = countryCode
				country = countryCode
				if country != "" && country != node.Country {
					providerUpdates["country"] = country
					node.Country = country
				}
			}
			if result.Region != "" {
				regionHint = result.Region
				if explorer.Region == "" {
					updates["region"] = result.Region
				}
				if node.Region == "" {
					providerUpdates["region"] = result.Region
					node.Region = result.Region
				}
			}
		}
	}
	hubCity, hubLat, hubLon, hubOK := geo.ApplyRegionalHubCoords(
		country,
		firstNonEmptyStr(city, ipCity),
		regionHint,
		lat,
		lon,
	)
	if hubOK {
		lat, lon = hubLat, hubLon
		city = hubCity
		updates["city"] = hubCity
	} else if math.Abs(lat) < 0.01 && math.Abs(lon) < 0.01 && city != "" {
		if clat, clon, ok := geo.CityCentroid(city, country); ok {
			lat, lon = clat, clon
		}
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
	effectiveCity := explorer.City
	if v, ok := updates["city"].(string); ok && v != "" {
		effectiveCity = v
	} else if city != "" {
		effectiveCity = city
	}
	anchor := geo.MapGeoAnchor(providerNodeID, "", "")
	_, _, fallbackGeo := geo.ApplyMapCoords(lat, lon, effectiveCountry, effectiveCity, anchor)
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
			Where("country IS NULL OR country = '' OR country = 'verify-smoke'").
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
		if EnrichExplorerForProviderNode(id) {
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
