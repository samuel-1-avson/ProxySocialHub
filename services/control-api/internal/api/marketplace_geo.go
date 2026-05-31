package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	geo "github.com/proxyhubb/control-api/internal/geo"
	"github.com/proxyhubb/control-api/internal/logging"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

// MarketplaceGeoPin is a map-ready listing with resolved coordinates.
type MarketplaceGeoPin struct {
	ListingID            string  `json:"listing_id"`
	Title                string  `json:"title"`
	SellerID             string  `json:"seller_id"`
	ProxyType            string  `json:"proxy_type"`
	Protocol             string  `json:"protocol"`
	Country              string  `json:"country"`
	ISP                  string  `json:"isp,omitempty"`
	City                 string  `json:"city,omitempty"`
	PricePerGB           float64 `json:"price_per_gb"`
	AvailableBandwidthGB float64 `json:"available_bandwidth_gb"`
	Lat                  float64 `json:"lat"`
	Lon                  float64 `json:"lon"`
	NodeID               string  `json:"node_id,omitempty"`
	NodeActive           bool    `json:"node_active"`
	UptimePercent        float64 `json:"uptime_percent"`
	LatencyMs            int     `json:"latency_ms"`
	SLASource            string  `json:"sla_source"` // gateway | explorer | provider | listing
	GeoResolved          bool    `json:"geo_resolved"`
	Purchasable          bool    `json:"purchasable"`
}

// RegisterMarketplaceGeoRoutes registers map geo endpoints (call before listing :id routes).
func RegisterMarketplaceGeoRoutes(rg *gin.RouterGroup) {
	limit := RateLimitWithConfig(30, time.Minute)
	rg.GET("/listings/geo", limit, getMarketplaceGeo)
	rg.GET("/marketplace/geo", limit, getMarketplaceGeo)
}

// MarketplaceGeoResponse is returned by GET /v1/listings/geo.
type MarketplaceGeoResponse struct {
	Pins  []MarketplaceGeoPin `json:"pins"`
	Total int                 `json:"total"`
}

type marketplaceGeoRow struct {
	ListingID            string  `gorm:"column:listing_id"`
	Title                string  `gorm:"column:title"`
	SellerID             string  `gorm:"column:seller_id"`
	ProxyType            string  `gorm:"column:proxy_type"`
	Protocol             string  `gorm:"column:protocol"`
	Country              string  `gorm:"column:country"`
	ISP                  string  `gorm:"column:isp"`
	City                 string  `gorm:"column:city"`
	PricePerGB           float64 `gorm:"column:price_per_gb"`
	AvailableBandwidthGB float64 `gorm:"column:available_bandwidth_gb"`
	Lat                  float64 `gorm:"column:lat"`
	Lon                  float64 `gorm:"column:lon"`
	NodeID               string  `gorm:"column:node_id"`
	NodeActive           bool    `gorm:"column:node_active"`
	UptimePercent        float64 `gorm:"column:uptime_percent"`
	LatencyMs            int     `gorm:"column:latency_ms"`
	SLASource            string  `gorm:"column:sla_source"`
	GeoResolved          bool    `gorm:"column:geo_resolved"`
}

// parseBBox parses west,south,east,north from a query string.
func parseBBox(raw string) (west, south, east, north float64, ok bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, 0, 0, 0, false
	}
	parts := strings.Split(raw, ",")
	if len(parts) != 4 {
		return 0, 0, 0, 0, false
	}
	vals := make([]float64, 4)
	for i, p := range parts {
		v, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil {
			return 0, 0, 0, 0, false
		}
		vals[i] = v
	}
	return vals[0], vals[1], vals[2], vals[3], true
}

// getMarketplaceGeo returns active listings with coordinates for the marketplace map.
func getMarketplaceGeo(c *gin.Context) {
	country := c.Query("country")
	proxyType := c.Query("proxy_type")
	bboxRaw := c.Query("bbox")

	cacheKey := fmt.Sprintf("marketplace:geo:c:%s:pt:%s:b:%s", country, proxyType, bboxRaw)
	if redisClient.Client != nil {
		if cached, err := redisClient.Client.Get(c, cacheKey).Result(); err == nil && cached != "" {
			var resp MarketplaceGeoResponse
			if err := json.Unmarshal([]byte(cached), &resp); err == nil {
				c.JSON(http.StatusOK, resp)
				return
			}
		}
	}

	query := `
SELECT
    pl.id::text AS listing_id,
    pl.title,
    pl.seller_id::text AS seller_id,
    pl.proxy_type,
    pl.protocol,
    COALESCE(NULLIF(pl.country, ''), NULLIF(pn.country, ''), NULLIF(en.country, '')) AS country,
    COALESCE(pl.isp, '') AS isp,
    COALESCE(en.city, pn.city, gw.city, '') AS city,
    pl.price_per_gb,
    pl.available_bandwidth_gb,
    COALESCE(en.latitude, 0) AS lat,
    COALESCE(en.longitude, 0) AS lon,
    COALESCE(NULLIF(en.node_id, ''), NULLIF(pn.gateway_node_id, ''), NULLIF(gw.gateway_node_id, ''), '') AS node_id,
    COALESCE(gw.is_healthy, en.is_active, pn.status = 'online', false) AS node_active,
    CASE
        WHEN gw.id IS NOT NULL THEN gw.uptime_percent
        WHEN en.node_id IS NOT NULL AND COALESCE(en.uptime_percent, 0) > 0 THEN en.uptime_percent
        WHEN pn.id IS NOT NULL AND COALESCE(pn.uptime_percent, 0) > 0 THEN pn.uptime_percent
        ELSE COALESCE(pl.uptime_percent, 0)
    END AS uptime_percent,
    COALESCE(gw.latency_ms, 0) AS latency_ms,
    CASE
        WHEN gw.id IS NOT NULL THEN 'gateway'
        WHEN en.node_id IS NOT NULL AND COALESCE(en.uptime_percent, 0) > 0 THEN 'explorer'
        WHEN pn.id IS NOT NULL AND COALESCE(pn.uptime_percent, 0) > 0 THEN 'provider'
        ELSE 'listing'
    END AS sla_source,
    (
        (ABS(COALESCE(en.latitude, 0)) > 0.01 OR ABS(COALESCE(en.longitude, 0)) > 0.01)
        OR COALESCE(pl.country, '') <> ''
    ) AS geo_resolved
FROM proxy_listings pl
LEFT JOIN LATERAL (
    SELECT pn.id, pn.gateway_node_id, pn.status, pn.uptime_percent, pn.city, pn.country
    FROM provider_nodes pn
    WHERE
        (pl.provider_node_id IS NOT NULL AND pn.id = pl.provider_node_id)
        OR (pl.provider_node_id IS NULL AND pn.user_id = pl.seller_id)
    ORDER BY
        CASE WHEN pl.provider_node_id IS NOT NULL AND pn.id = pl.provider_node_id THEN 0 ELSE 1 END,
        CASE WHEN pn.status = 'online' THEN 0 ELSE 1 END,
        pn.last_seen_at DESC NULLS LAST,
        pn.created_at DESC
    LIMIT 1
) pn ON TRUE
LEFT JOIN nodes n_geo ON
    n_geo.deleted_at IS NULL
    AND pn.gateway_node_id IS NOT NULL
    AND pn.gateway_node_id <> ''
    AND n_geo.gateway_node_id = pn.gateway_node_id
LEFT JOIN explorer_nodes en ON
    (n_geo.id IS NOT NULL AND en.node_id = n_geo.id::text)
    OR (
        (pn.gateway_node_id IS NULL OR pn.gateway_node_id = '')
        AND en.provider_user_id = pl.seller_id
    )
LEFT JOIN LATERAL (
    SELECT n.id, n.gateway_node_id, n.is_healthy, n.uptime_percent, n.latency_ms, n.city
    FROM nodes n
    WHERE n.deleted_at IS NULL
      AND (
          (pn.id IS NOT NULL AND n.provider_node_id = pn.id)
          OR (
              pn.gateway_node_id IS NOT NULL AND pn.gateway_node_id <> ''
              AND n.gateway_node_id = pn.gateway_node_id
          )
      )
    ORDER BY n.last_seen_at DESC NULLS LAST
    LIMIT 1
) gw ON TRUE
WHERE pl.status = 'active'
  AND pl.available_bandwidth_gb > 0`

	args := []interface{}{}
	argN := 1
	if country != "" {
		query += fmt.Sprintf(" AND pl.country = $%d", argN)
		args = append(args, country)
		argN++
	}
	if proxyType != "" {
		query += fmt.Sprintf(" AND pl.proxy_type = $%d", argN)
		args = append(args, proxyType)
		argN++
	}
	west, south, east, north, hasBBox := parseBBox(bboxRaw)
	query += " ORDER BY pl.created_at DESC LIMIT 5000"

	var rows []marketplaceGeoRow
	if err := db.DB.Raw(query, args...).Scan(&rows).Error; err != nil {
		logging.Error(err).Msg("[Marketplace] getMarketplaceGeo query failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch marketplace geo data"})
		return
	}

	pins := make([]MarketplaceGeoPin, 0, len(rows))
	for i, r := range rows {
		purchasable := r.AvailableBandwidthGB > 0
		lat, lon, centroidOK := geo.ApplyListingCoords(r.Lat, r.Lon, r.Country, i)
		if hasBBox && !geo.PinInBBox(lat, lon, west, south, east, north) {
			continue
		}
		geoResolved := r.GeoResolved || centroidOK
		pins = append(pins, MarketplaceGeoPin{
			ListingID:            r.ListingID,
			Title:                r.Title,
			SellerID:             r.SellerID,
			ProxyType:            r.ProxyType,
			Protocol:             r.Protocol,
			Country:              r.Country,
			ISP:                  r.ISP,
			City:                 r.City,
			PricePerGB:           r.PricePerGB,
			AvailableBandwidthGB: r.AvailableBandwidthGB,
			Lat:                  lat,
			Lon:                  lon,
			NodeID:               r.NodeID,
			NodeActive:           r.NodeActive,
			UptimePercent:        r.UptimePercent,
			LatencyMs:            r.LatencyMs,
			SLASource:            r.SLASource,
			GeoResolved:          geoResolved || r.GeoResolved,
			Purchasable:          purchasable,
		})
	}

	resp := MarketplaceGeoResponse{Pins: pins, Total: len(pins)}
	cacheResponse(c, cacheKey, resp, 30*time.Second)
	c.JSON(http.StatusOK, resp)
}
