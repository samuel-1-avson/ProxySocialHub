package api

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
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
	ListingOfferVerified bool    `json:"listing_offer_verified"`
	ListingOfferSigner   string  `json:"listing_offer_signer,omitempty"`
	ListingOfferSignedAt string  `json:"listing_offer_signed_at,omitempty"`
	ListingOfferError    string  `json:"listing_offer_verification_error,omitempty"`
	HeartbeatVerified    bool    `json:"heartbeat_verified,omitempty"`
	HeartbeatSigner      string  `json:"heartbeat_signer,omitempty"`
	HeartbeatSignedAt    string  `json:"heartbeat_signed_at,omitempty"`
	HeartbeatError       string  `json:"heartbeat_verification_error,omitempty"`
}

// RegisterMarketplaceGeoRoutes registers map geo endpoints (call before listing :id routes).
func RegisterMarketplaceGeoRoutes(rg *gin.RouterGroup) {
	limit := RateLimitWithConfig(30, time.Minute)
	rg.GET("/marketplace/proof-policy", getListingProofPolicy)
	rg.GET("/listings/geo", limit, getMarketplaceGeo)
	rg.GET("/marketplace/geo", limit, getMarketplaceGeo)
	rg.GET("/marketplace/map", limit, getMarketplaceMap)
}

// MarketplaceGeoResponse is returned by GET /v1/listings/geo.
type MarketplaceGeoResponse struct {
	Pins  []MarketplaceGeoPin `json:"pins"`
	Total int                 `json:"total"`
}

// MarketplaceMapPoint is the unified map payload used by marketplace-first map views.
type MarketplaceMapPoint struct {
	ID                   string  `json:"id"`
	Kind                 string  `json:"kind"`
	Latitude             float64 `json:"lat"`
	Longitude            float64 `json:"lon"`
	Title                string  `json:"title"`
	Country              string  `json:"country,omitempty"`
	City                 string  `json:"city,omitempty"`
	ISP                  string  `json:"isp,omitempty"`
	Status               string  `json:"status"`
	Purchasable          bool    `json:"purchasable"`
	ListingID            string  `json:"listing_id,omitempty"`
	NodeID               string  `json:"node_id,omitempty"`
	SellerID             string  `json:"seller_id,omitempty"`
	ProxyType            string  `json:"proxy_type,omitempty"`
	Protocol             string  `json:"protocol,omitempty"`
	PricePerGB           float64 `json:"price_per_gb,omitempty"`
	AvailableBandwidthGB float64 `json:"available_bandwidth_gb,omitempty"`
	UptimePercent        float64 `json:"uptime_percent,omitempty"`
	LatencyMs            int     `json:"latency_ms,omitempty"`
	IsValidator          bool    `json:"is_validator,omitempty"`
	ActiveSessions       int     `json:"active_sessions,omitempty"`
	SLASource            string  `json:"sla_source,omitempty"`
	GeoSource            string  `json:"geo_source"`
	ListingOfferVerified bool    `json:"listing_offer_verified,omitempty"`
	ListingOfferSigner   string  `json:"listing_offer_signer,omitempty"`
	ListingOfferSignedAt string  `json:"listing_offer_signed_at,omitempty"`
	ListingOfferError    string  `json:"listing_offer_verification_error,omitempty"`
	HeartbeatVerified    bool    `json:"heartbeat_verified,omitempty"`
	HeartbeatSigner      string  `json:"heartbeat_signer,omitempty"`
	HeartbeatSignedAt    string  `json:"heartbeat_signed_at,omitempty"`
	HeartbeatError       string  `json:"heartbeat_verification_error,omitempty"`
}

// MarketplaceMapResponse is returned by GET /v1/marketplace/map.
type MarketplaceMapResponse struct {
	Points       []MarketplaceMapPoint `json:"points"`
	Total        int                   `json:"total"`
	ListingCount int                   `json:"listing_count"`
	NodeCount    int                   `json:"node_count"`
	BBoxApplied  bool                  `json:"bbox_applied"`
	GeneratedAt  time.Time             `json:"generated_at"`
}

type marketplaceMapFilters struct {
	Country         string
	ProxyType       string
	Protocol        string
	MinPrice        *float64
	MaxPrice        *float64
	MinUptime       *float64
	MaxLatency      *int
	PurchasableOnly bool
	IncludeNodes    bool
	ActiveNodesOnly bool
	BBoxRaw         string
}

type marketplaceGeoRow struct {
	ListingID            string     `gorm:"column:listing_id"`
	Title                string     `gorm:"column:title"`
	SellerID             string     `gorm:"column:seller_id"`
	Status               string     `gorm:"column:status"`
	ProxyType            string     `gorm:"column:proxy_type"`
	Protocol             string     `gorm:"column:protocol"`
	Country              string     `gorm:"column:country"`
	ISP                  string     `gorm:"column:isp"`
	City                 string     `gorm:"column:city"`
	PricePerGB           float64    `gorm:"column:price_per_gb"`
	AvailableBandwidthGB float64    `gorm:"column:available_bandwidth_gb"`
	Lat                  float64    `gorm:"column:lat"`
	Lon                  float64    `gorm:"column:lon"`
	NodeID               string     `gorm:"column:node_id"`
	NodeActive           bool       `gorm:"column:node_active"`
	UptimePercent        float64    `gorm:"column:uptime_percent"`
	LatencyMs            int        `gorm:"column:latency_ms"`
	SLASource            string     `gorm:"column:sla_source"`
	GeoResolved          bool       `gorm:"column:geo_resolved"`
	ListingOfferVerified bool       `gorm:"column:listing_offer_verified"`
	ListingOfferSigner   string     `gorm:"column:listing_offer_signer"`
	ListingOfferSignedAt *time.Time `gorm:"column:listing_offer_signed_at"`
	ListingOfferError    string     `gorm:"column:listing_offer_verification_error"`
	HeartbeatVerified    bool       `gorm:"column:heartbeat_verified"`
	HeartbeatSigner      string     `gorm:"column:heartbeat_signer"`
	HeartbeatSignedAt    *time.Time `gorm:"column:heartbeat_signed_at"`
	HeartbeatError       string     `gorm:"column:heartbeat_verification_error"`
}

type marketplaceMapNodeRow struct {
	NodeID            string     `gorm:"column:node_id"`
	Name              string     `gorm:"column:name"`
	Lat               float64    `gorm:"column:lat"`
	Lon               float64    `gorm:"column:lon"`
	IsActive          bool       `gorm:"column:is_active"`
	IsValidator       bool       `gorm:"column:is_validator"`
	UptimePercent     float64    `gorm:"column:uptime_percent"`
	ActiveSessions    int        `gorm:"column:active_sessions"`
	Country           string     `gorm:"column:country"`
	Region            string     `gorm:"column:region"`
	City              string     `gorm:"column:city"`
	ISP               string     `gorm:"column:isp"`
	HeartbeatVerified bool       `gorm:"column:heartbeat_verified"`
	HeartbeatSigner   string     `gorm:"column:heartbeat_signer"`
	HeartbeatSignedAt *time.Time `gorm:"column:heartbeat_signed_at"`
	HeartbeatError    string     `gorm:"column:heartbeat_verification_error"`
}

func parseOptionalFloat(raw string) *float64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return nil
	}
	return &v
}

func parseOptionalInt(raw string) *int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return nil
	}
	return &v
}

func proofTimeString(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func buildMarketplaceMapFilters(c *gin.Context) marketplaceMapFilters {
	purchasableOnly := true
	if raw := strings.TrimSpace(c.Query("purchasable_only")); raw != "" {
		if parsed, err := strconv.ParseBool(raw); err == nil {
			purchasableOnly = parsed
		}
	}
	return marketplaceMapFilters{
		Country:         strings.TrimSpace(c.Query("country")),
		ProxyType:       strings.TrimSpace(c.Query("proxy_type")),
		Protocol:        strings.TrimSpace(c.Query("protocol")),
		MinPrice:        parseOptionalFloat(c.Query("min_price")),
		MaxPrice:        parseOptionalFloat(c.Query("max_price")),
		MinUptime:       parseOptionalFloat(c.Query("min_uptime")),
		MaxLatency:      parseOptionalInt(c.Query("max_latency")),
		PurchasableOnly: purchasableOnly,
		IncludeNodes:    c.DefaultQuery("include_nodes", "false") == "true",
		ActiveNodesOnly: c.DefaultQuery("active_nodes_only", "false") == "true",
		BBoxRaw:         strings.TrimSpace(c.Query("bbox")),
	}
}

func marketplaceMapCacheKey(c *gin.Context, filters marketplaceMapFilters) string {
	values := url.Values{}
	for key, vals := range c.Request.URL.Query() {
		for _, value := range vals {
			values.Add(key, value)
		}
	}
	if !values.Has("purchasable_only") && filters.PurchasableOnly {
		values.Set("purchasable_only", "true")
	}
	return "marketplace:map:" + values.Encode()
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
    pl.status,
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
    ) AS geo_resolved,
    COALESCE(pl.listing_offer_verified, false) AS listing_offer_verified,
    COALESCE(pl.listing_offer_signer, '') AS listing_offer_signer,
    pl.listing_offer_signed_at AS listing_offer_signed_at,
    COALESCE(pl.listing_offer_verification_error, '') AS listing_offer_verification_error,
    COALESCE(pn.latest_heartbeat_verified, false) AS heartbeat_verified,
    COALESCE(pn.latest_heartbeat_signer, '') AS heartbeat_signer,
    pn.latest_heartbeat_signed_at AS heartbeat_signed_at,
    COALESCE(pn.latest_heartbeat_verification_error, '') AS heartbeat_verification_error
FROM proxy_listings pl
LEFT JOIN LATERAL (
    SELECT
        pn.id,
        pn.gateway_node_id,
        pn.status,
        pn.uptime_percent,
        pn.city,
        pn.country,
        pn.latest_heartbeat_verified,
        pn.latest_heartbeat_signer,
        pn.latest_heartbeat_signed_at,
        pn.latest_heartbeat_verification_error
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
			ListingOfferVerified: r.ListingOfferVerified,
			ListingOfferSigner:   r.ListingOfferSigner,
			ListingOfferSignedAt: proofTimeString(r.ListingOfferSignedAt),
			ListingOfferError:    r.ListingOfferError,
			HeartbeatVerified:    r.HeartbeatVerified,
			HeartbeatSigner:      r.HeartbeatSigner,
			HeartbeatSignedAt:    proofTimeString(r.HeartbeatSignedAt),
			HeartbeatError:       r.HeartbeatError,
		})
	}

	resp := MarketplaceGeoResponse{Pins: pins, Total: len(pins)}
	cacheResponse(c, cacheKey, resp, 30*time.Second)
	c.JSON(http.StatusOK, resp)
}

// getMarketplaceMap returns unified marketplace map points.
func getMarketplaceMap(c *gin.Context) {
	filters := buildMarketplaceMapFilters(c)
	cacheKey := marketplaceMapCacheKey(c, filters)

	if redisClient.Client != nil {
		if cached, err := redisClient.Client.Get(c, cacheKey).Result(); err == nil && cached != "" {
			var resp MarketplaceMapResponse
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
    pl.status,
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
    ) AS geo_resolved,
    COALESCE(pl.listing_offer_verified, false) AS listing_offer_verified,
    COALESCE(pl.listing_offer_signer, '') AS listing_offer_signer,
    pl.listing_offer_signed_at AS listing_offer_signed_at,
    COALESCE(pl.listing_offer_verification_error, '') AS listing_offer_verification_error,
    COALESCE(pn.latest_heartbeat_verified, false) AS heartbeat_verified,
    COALESCE(pn.latest_heartbeat_signer, '') AS heartbeat_signer,
    pn.latest_heartbeat_signed_at AS heartbeat_signed_at,
    COALESCE(pn.latest_heartbeat_verification_error, '') AS heartbeat_verification_error
FROM proxy_listings pl
LEFT JOIN LATERAL (
    SELECT
        pn.id,
        pn.gateway_node_id,
        pn.status,
        pn.uptime_percent,
        pn.city,
        pn.country,
        pn.latest_heartbeat_verified,
        pn.latest_heartbeat_signer,
        pn.latest_heartbeat_signed_at,
        pn.latest_heartbeat_verification_error
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
WHERE pl.status <> 'deleted'`

	args := []interface{}{}
	argN := 1
	if filters.PurchasableOnly {
		query += " AND pl.status = 'active' AND pl.available_bandwidth_gb > 0"
	}
	if filters.Country != "" {
		query += fmt.Sprintf(" AND pl.country = $%d", argN)
		args = append(args, filters.Country)
		argN++
	}
	if filters.ProxyType != "" {
		query += fmt.Sprintf(" AND pl.proxy_type = $%d", argN)
		args = append(args, filters.ProxyType)
		argN++
	}
	if filters.Protocol != "" {
		query += fmt.Sprintf(" AND LOWER(pl.protocol) = LOWER($%d)", argN)
		args = append(args, filters.Protocol)
		argN++
	}
	if filters.MinPrice != nil {
		query += fmt.Sprintf(" AND pl.price_per_gb >= $%d", argN)
		args = append(args, *filters.MinPrice)
		argN++
	}
	if filters.MaxPrice != nil {
		query += fmt.Sprintf(" AND pl.price_per_gb <= $%d", argN)
		args = append(args, *filters.MaxPrice)
		argN++
	}
	if filters.MinUptime != nil {
		query += fmt.Sprintf(" AND COALESCE(gw.uptime_percent, en.uptime_percent, pn.uptime_percent, pl.uptime_percent, 0) >= $%d", argN)
		args = append(args, *filters.MinUptime)
		argN++
	}
	if filters.MaxLatency != nil {
		query += fmt.Sprintf(" AND (COALESCE(gw.latency_ms, 0) = 0 OR COALESCE(gw.latency_ms, 0) <= $%d)", argN)
		args = append(args, *filters.MaxLatency)
		argN++
	}

	west, south, east, north, hasBBox := parseBBox(filters.BBoxRaw)
	query += " ORDER BY pl.status ASC, pl.created_at DESC LIMIT 5000"

	var rows []marketplaceGeoRow
	if err := db.DB.Raw(query, args...).Scan(&rows).Error; err != nil {
		logging.Error(err).Msg("[Marketplace] getMarketplaceMap query failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch marketplace map data"})
		return
	}

	points := make([]MarketplaceMapPoint, 0, len(rows))
	for i, r := range rows {
		lat, lon, centroidOK := geo.ApplyListingCoords(r.Lat, r.Lon, r.Country, i)
		if hasBBox && !geo.PinInBBox(lat, lon, west, south, east, north) {
			continue
		}
		purchasable := r.Status == "active" && r.AvailableBandwidthGB > 0
		points = append(points, MarketplaceMapPoint{
			ID:                   "listing:" + r.ListingID,
			Kind:                 "listing",
			Latitude:             lat,
			Longitude:            lon,
			Title:                r.Title,
			Country:              r.Country,
			City:                 r.City,
			ISP:                  r.ISP,
			Status:               r.Status,
			Purchasable:          purchasable,
			ListingID:            r.ListingID,
			NodeID:               r.NodeID,
			SellerID:             r.SellerID,
			ProxyType:            r.ProxyType,
			Protocol:             r.Protocol,
			PricePerGB:           r.PricePerGB,
			AvailableBandwidthGB: r.AvailableBandwidthGB,
			UptimePercent:        r.UptimePercent,
			LatencyMs:            r.LatencyMs,
			SLASource:            r.SLASource,
			GeoSource:            marketplaceGeoSource(r, centroidOK),
			ListingOfferVerified: r.ListingOfferVerified,
			ListingOfferSigner:   r.ListingOfferSigner,
			ListingOfferSignedAt: proofTimeString(r.ListingOfferSignedAt),
			ListingOfferError:    r.ListingOfferError,
			HeartbeatVerified:    r.HeartbeatVerified,
			HeartbeatSigner:      r.HeartbeatSigner,
			HeartbeatSignedAt:    proofTimeString(r.HeartbeatSignedAt),
			HeartbeatError:       r.HeartbeatError,
		})
	}
	listingCount := len(points)

	if filters.IncludeNodes {
		nodePoints, err := marketplaceMapNodePoints(filters, west, south, east, north, hasBBox)
		if err != nil {
			logging.Error(err).Msg("[Marketplace] getMarketplaceMap node query failed")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch marketplace map node data"})
			return
		}
		points = append(points, nodePoints...)
	}
	nodeCount := len(points) - listingCount

	resp := MarketplaceMapResponse{
		Points:       points,
		Total:        len(points),
		ListingCount: listingCount,
		NodeCount:    nodeCount,
		BBoxApplied:  hasBBox,
		GeneratedAt:  time.Now().UTC(),
	}
	cacheResponse(c, cacheKey, resp, 30*time.Second)
	c.JSON(http.StatusOK, resp)
}

func marketplaceGeoSource(row marketplaceGeoRow, centroidOK bool) string {
	if math.Abs(row.Lat) > 0.01 || math.Abs(row.Lon) > 0.01 {
		switch row.SLASource {
		case "gateway", "explorer", "provider":
			return row.SLASource
		default:
			return "explorer"
		}
	}
	if centroidOK {
		return "country_centroid"
	}
	return "unknown"
}

func marketplaceMapNodePoints(filters marketplaceMapFilters, west, south, east, north float64, hasBBox bool) ([]MarketplaceMapPoint, error) {
	query := db.DB.Table("explorer_nodes en").
		Select(`
            en.node_id,
            en.name,
            en.latitude AS lat,
            en.longitude AS lon,
            en.is_active,
            en.is_validator,
            en.uptime_percent,
            en.active_sessions,
            en.country,
            en.region,
            en.city,
            en.isp,
            COALESCE(pn.latest_heartbeat_verified, false) AS heartbeat_verified,
            COALESCE(pn.latest_heartbeat_signer, '') AS heartbeat_signer,
            pn.latest_heartbeat_signed_at AS heartbeat_signed_at,
            COALESCE(pn.latest_heartbeat_verification_error, '') AS heartbeat_verification_error
        `).
		Joins(`
            LEFT JOIN nodes n ON n.deleted_at IS NULL
                AND (n.id::text = en.node_id OR n.gateway_node_id = en.node_id)
        `).
		Joins(`
            LEFT JOIN LATERAL (
                SELECT
                    pn.latest_heartbeat_verified,
                    pn.latest_heartbeat_signer,
                    pn.latest_heartbeat_signed_at,
                    pn.latest_heartbeat_verification_error
                FROM provider_nodes pn
                WHERE
                    (n.provider_node_id IS NOT NULL AND pn.id = n.provider_node_id)
                    OR (
                        n.provider_node_id IS NULL
                        AND n.gateway_node_id IS NOT NULL
                        AND n.gateway_node_id <> ''
                        AND pn.gateway_node_id = n.gateway_node_id
                    )
                    OR (
						en.provider_user_id IS NOT NULL
						AND pn.user_id::text = en.provider_user_id::text
                    )
                ORDER BY
                    CASE WHEN pn.status = 'online' THEN 0 ELSE 1 END,
                    pn.last_seen_at DESC NULLS LAST,
                    pn.created_at DESC
                LIMIT 1
            ) pn ON TRUE
        `)
	if filters.ActiveNodesOnly {
		query = query.Where("en.is_active = ?", true)
	}
	if filters.Country != "" {
		query = query.Where("en.country = ? OR en.region = ?", filters.Country, filters.Country)
	}
	if filters.MinUptime != nil {
		query = query.Where("en.uptime_percent >= ?", *filters.MinUptime)
	}

	var rows []marketplaceMapNodeRow
	if err := query.Order("en.is_active DESC, en.uptime_percent DESC").Limit(5000).Scan(&rows).Error; err != nil {
		return nil, err
	}

	points := make([]MarketplaceMapPoint, 0, len(rows))
	for i, r := range rows {
		lat, lon, centroidOK := geo.ApplyListingCoords(r.Lat, r.Lon, r.Country, i)
		if hasBBox && !geo.PinInBBox(lat, lon, west, south, east, north) {
			continue
		}
		status := "offline"
		if r.IsActive {
			status = "active"
		}
		title := r.Name
		if title == "" {
			title = r.NodeID
		}
		points = append(points, MarketplaceMapPoint{
			ID:                   "node:" + r.NodeID,
			Kind:                 "node",
			Latitude:             lat,
			Longitude:            lon,
			Title:                title,
			Country:              r.Country,
			City:                 r.City,
			ISP:                  r.ISP,
			Status:               status,
			Purchasable:          false,
			NodeID:               r.NodeID,
			UptimePercent:        r.UptimePercent,
			IsValidator:          r.IsValidator,
			ActiveSessions:       r.ActiveSessions,
			GeoSource:            marketplaceNodeGeoSource(r, centroidOK),
			AvailableBandwidthGB: 0,
			HeartbeatVerified:    r.HeartbeatVerified,
			HeartbeatSigner:      r.HeartbeatSigner,
			HeartbeatSignedAt:    proofTimeString(r.HeartbeatSignedAt),
			HeartbeatError:       r.HeartbeatError,
		})
	}
	return points, nil
}

func marketplaceNodeGeoSource(row marketplaceMapNodeRow, centroidOK bool) string {
	if math.Abs(row.Lat) > 0.01 || math.Abs(row.Lon) > 0.01 {
		return "explorer"
	}
	if centroidOK {
		return "country_centroid"
	}
	return "unknown"
}
