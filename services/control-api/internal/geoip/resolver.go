// Package geoip provides a lightweight IP-to-coordinates resolver that uses
// the ip-api.com JSON endpoint. Results are cached in memory to avoid
// hammering the upstream service.
//
// Usage:
//
//	geoip.StartBackfillWorker()   // call once at startup
package geoip

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/geo"
	"github.com/proxyhubb/control-api/internal/models"
)

// Result is the resolved geographic data for one IP address.
type Result struct {
	Latitude  float64
	Longitude float64
	City      string
	Region    string
	Country   string
	ISP       string
}

// ipAPIResponse mirrors the ip-api.com JSON response.
type ipAPIResponse struct {
	Status      string  `json:"status"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	City        string  `json:"city"`
	Region      string  `json:"regionName"`
	Country     string  `json:"country"`
	CountryCode string  `json:"countryCode"`
	ISP         string  `json:"isp"`
	Message     string  `json:"message,omitempty"`
}

var (
	cacheMu sync.RWMutex
	cache   = make(map[string]Result)

	httpClient = &http.Client{Timeout: 5 * time.Second}
)

// Resolve looks up geographic data for the given IP address.
// It returns (Result, true) on success, or (zero, false) on failure.
// Results are cached for the process lifetime.
func Resolve(ip string) (Result, bool) {
	// Skip loopback and LAN only (allow RFC 5737 documentation/test nets used in dev).
	if parsed := net.ParseIP(ip); parsed == nil || parsed.IsLoopback() || IsLANIP(parsed) {
		return Result{}, false
	}

	cacheMu.RLock()
	if r, ok := cache[ip]; ok {
		cacheMu.RUnlock()
		return r, true
	}
	cacheMu.RUnlock()

	url := fmt.Sprintf("http://ip-api.com/json/%s?fields=status,lat,lon,city,regionName,country,countryCode,isp,message", ip)
	resp, err := httpClient.Get(url)
	if err != nil {
		return Result{}, false
	}
	defer resp.Body.Close()

	var apiResp ipAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return Result{}, false
	}
	if apiResp.Status != "success" {
		return Result{}, false
	}

	country := strings.TrimSpace(apiResp.CountryCode)
	if country == "" {
		country = normalizeCountryCode(apiResp.Country)
	} else {
		country = strings.ToUpper(country)
	}

	result := Result{
		Latitude:  apiResp.Lat,
		Longitude: apiResp.Lon,
		City:      apiResp.City,
		Region:    apiResp.Region,
		Country:   country,
		ISP:       apiResp.ISP,
	}

	cacheMu.Lock()
	cache[ip] = result
	cacheMu.Unlock()
	return result, true
}

// IsCloudHostedISP reports whether an ISP string looks like a cloud/datacenter
// host (not a residential provider egress). Map pins must not use these when a
// provider has declared a home country — classic failure was Google Cloud WAN
// on the control-api host geolocating every mis-keyed node to Chicago.
func IsCloudHostedISP(isp string) bool {
	s := strings.ToLower(strings.TrimSpace(isp))
	if s == "" {
		return false
	}
	needles := []string{
		"google", "amazon", "aws", "microsoft", "azure", "digitalocean",
		"linode", "akamai", "cloudflare", "hetzner", "ovh", "vultr",
		"oracle cloud", "alibaba", "tencent", "softlayer", "ibm cloud",
	}
	for _, n := range needles {
		if strings.Contains(s, n) {
			return true
		}
	}
	return false
}

func normalizeCountryCode(country string) string {
	return geo.NormalizeCountryCode(country)
}

// ResolveNextBatch fetches up to 45 nodes with missing coordinates and
// updates them in the database. Returns how many nodes were updated.
func ResolveNextBatch() int {
	if db.DB == nil {
		return 0
	}

	var nodes []models.ExplorerNode
	// Only fetch nodes that have an IP but no coordinates yet
	if err := db.DB.
		Where("ip != '' AND ip IS NOT NULL AND (ABS(latitude) < 0.01 AND ABS(longitude) < 0.01)").
		Limit(45).
		Find(&nodes).Error; err != nil {
		log.Printf("[GeoIP] Backfill query error: %v", err)
		return 0
	}

	if len(nodes) == 0 {
		return 0
	}

	log.Printf("[GeoIP] Resolving coordinates for %d node(s)", len(nodes))

	updated := 0
	for _, node := range nodes {
		effectiveIP := PublicIPForGeo(node.IP)
		if effectiveIP == "" || IsControlPlanePublicIP(effectiveIP) || IsUntrustedGatewayGeo(effectiveIP, node.ISP) {
			// Drop poisoned control-plane / cloud IPs so they cannot keep
			// backfilling Chicago (or other cloud hubs) forever.
			_ = db.DB.Model(&models.ExplorerNode{}).Where("id = ?", node.ID).Updates(map[string]interface{}{
				"ip":  "",
				"isp": "",
			}).Error
			continue
		}
		result, ok := Resolve(effectiveIP)
		if !ok {
			continue
		}
		if IsCloudHostedISP(result.ISP) {
			_ = db.DB.Model(&models.ExplorerNode{}).Where("id = ?", node.ID).Updates(map[string]interface{}{
				"ip":  "",
				"isp": "",
			}).Error
			continue
		}

		updates := map[string]interface{}{
			"latitude":  result.Latitude,
			"longitude": result.Longitude,
		}
		if result.City != "" {
			updates["city"] = result.City
		}
		if result.ISP != "" {
			updates["isp"] = result.ISP
		}
		if countryCode := normalizeCountryCode(result.Country); countryCode != "" && node.Country == "" {
			updates["country"] = countryCode
		}
		if result.Region != "" && node.Region == "" {
			updates["region"] = result.Region
		}

		if err := db.DB.Model(&models.ExplorerNode{}).
			Where("id = ?", node.ID).
			Updates(updates).Error; err != nil {
			log.Printf("[GeoIP] Failed to update node %s: %v", node.NodeID, err)
			continue
		}
		updated++

		if countryCode := normalizeCountryCode(result.Country); countryCode != "" && node.ProviderUserID != "" {
			db.DB.Exec(
				`UPDATE proxy_listings SET country = $1 WHERE seller_id = $2::uuid AND (country IS NULL OR country = '' OR country = 'verify-smoke')`,
				countryCode, node.ProviderUserID,
			)
			if node.Country == "" || node.Country == "verify-smoke" {
				db.DB.Model(&models.ExplorerNode{}).Where("id = ?", node.ID).Update("country", countryCode)
			}
		}

		// Small delay between requests to be polite to the free API
		time.Sleep(1400 * time.Millisecond)
	}
	return updated
}
