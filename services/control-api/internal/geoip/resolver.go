// Package geoip provides a lightweight IP-to-coordinates resolver that uses
// the free ip-api.com JSON endpoint. Results are cached in memory to avoid
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
	"sync"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
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
	Status  string  `json:"status"`
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	City    string  `json:"city"`
	Region  string  `json:"regionName"`
	Country string  `json:"country"`
	ISP     string  `json:"isp"`
	Message string  `json:"message,omitempty"`
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
	// Skip private / loopback addresses — they have no geo meaning
	if parsed := net.ParseIP(ip); parsed == nil || parsed.IsLoopback() || parsed.IsPrivate() {
		return Result{}, false
	}

	cacheMu.RLock()
	if r, ok := cache[ip]; ok {
		cacheMu.RUnlock()
		return r, true
	}
	cacheMu.RUnlock()

	url := fmt.Sprintf("https://ip-api.com/json/%s?fields=status,lat,lon,city,regionName,country,isp,message", ip)
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

	result := Result{
		Latitude:  apiResp.Lat,
		Longitude: apiResp.Lon,
		City:      apiResp.City,
		Region:    apiResp.Region,
		Country:   apiResp.Country,
		ISP:       apiResp.ISP,
	}

	cacheMu.Lock()
	cache[ip] = result
	cacheMu.Unlock()

	return result, true
}

// ResolveNextBatch fetches up to 45 nodes with missing coordinates and
// updates them in the database.
func ResolveNextBatch() {
	if db.DB == nil {
		return
	}

	var nodes []models.ExplorerNode
	// Only fetch nodes that have an IP but no coordinates yet
	if err := db.DB.
		Where("ip != '' AND ip IS NOT NULL AND (ABS(latitude) < 0.01 AND ABS(longitude) < 0.01)").
		Limit(45).
		Find(&nodes).Error; err != nil {
		log.Printf("[GeoIP] Backfill query error: %v", err)
		return
	}

	if len(nodes) == 0 {
		return
	}

	log.Printf("[GeoIP] Resolving coordinates for %d node(s)", len(nodes))

	for _, node := range nodes {
		result, ok := Resolve(node.IP)
		if !ok {
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
		if result.Country != "" && node.Country == "" {
			updates["country"] = result.Country
		}
		if result.Region != "" && node.Region == "" {
			updates["region"] = result.Region
		}

		if err := db.DB.Model(&models.ExplorerNode{}).
			Where("id = ?", node.ID).
			Updates(updates).Error; err != nil {
			log.Printf("[GeoIP] Failed to update node %s: %v", node.NodeID, err)
		}

		// Small delay between requests to be polite to the free API
		time.Sleep(1400 * time.Millisecond)
	}
}
