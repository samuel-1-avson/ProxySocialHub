package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
	geo "github.com/proxyhubb/control-api/internal/geo"
	"github.com/proxyhubb/control-api/internal/logging"
	catalogsvc "github.com/proxyhubb/control-api/internal/marketplace/catalog"
	"github.com/proxyhubb/control-api/internal/models"
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
	ListingOfferHash     string  `json:"listing_offer_hash,omitempty"`
	ListingOfferSigner   string  `json:"listing_offer_signer,omitempty"`
	ListingOfferSignedAt string  `json:"listing_offer_signed_at,omitempty"`
	ListingOfferError    string  `json:"listing_offer_verification_error,omitempty"`
	ProviderRegisteredOnChain bool `json:"provider_registered_on_chain,omitempty"`
	ProviderHasHotkey    bool    `json:"provider_has_hotkey,omitempty"`
	HeartbeatVerified    bool    `json:"heartbeat_verified,omitempty"`
	HeartbeatSigner      string  `json:"heartbeat_signer,omitempty"`
	HeartbeatSignedAt    string  `json:"heartbeat_signed_at,omitempty"`
	HeartbeatError       string  `json:"heartbeat_verification_error,omitempty"`
}

// RegisterMarketplaceGeoRoutes registers map geo endpoints (call before listing :id routes).
func RegisterMarketplaceGeoRoutes(rg *gin.RouterGroup) {
	limit := RateLimitWithConfig(30, time.Minute)
	rg.GET("/marketplace/proof-policy", getListingProofPolicy)
	geoDeprecated := deprecatedMarketplaceGeoHeaders()
	rg.GET("/listings/geo", limit, geoDeprecated, getMarketplaceGeo)
	rg.GET("/marketplace/geo", limit, geoDeprecated, getMarketplaceGeo)
	rg.GET("/marketplace/map", limit, getMarketplaceMap)
	rg.GET("/map/points", limit, getMarketplaceMap)
}

// MarketplaceGeoResponse is returned by GET /v1/listings/geo.
type MarketplaceGeoResponse struct {
	Pins      []MarketplaceGeoPin `json:"pins"`
	Total     int                 `json:"total"`
	Discovery DiscoveryHonesty    `json:"discovery"`
}

// MarketplaceMapPoint is the unified map payload used by marketplace-first map views.
// Public fields are privacy-hardened: no seller_id, no raw ISP, opaque node ids,
// approximate geo only, and quality signals without identity.
type MarketplaceMapPoint struct {
	ID                   string                        `json:"id"`
	Kind                 string                        `json:"kind"`
	Latitude             float64                       `json:"lat"`
	Longitude            float64                       `json:"lon"`
	Title                string                        `json:"title"`
	Country              string                        `json:"country,omitempty"`
	Region               string                        `json:"region,omitempty"`
	City                 string                        `json:"city,omitempty"`
	NetworkClass         string                        `json:"network_class,omitempty"`
	Status               string                        `json:"status"`
	Purchasable          bool                          `json:"purchasable"`
	ListingID            string                        `json:"listing_id,omitempty"`
	NodeID               string                        `json:"node_id,omitempty"` // opaque public id
	ProxyType            string                        `json:"proxy_type,omitempty"`
	Protocol             string                        `json:"protocol,omitempty"`
	PricePerGB           float64                       `json:"price_per_gb,omitempty"`
	AvailableBandwidthGB float64                       `json:"available_bandwidth_gb,omitempty"`
	UptimePercent        float64                       `json:"uptime_percent,omitempty"`
	LatencyMs            int                           `json:"latency_ms,omitempty"`
	QualityScore         float64                       `json:"quality_score,omitempty"`
	SuccessRate          float64                       `json:"success_rate,omitempty"`
	TrustBadge           string                        `json:"trust_badge,omitempty"`
	TrustLabel           string                        `json:"trust_label,omitempty"`
	IsValidator          bool                          `json:"is_validator,omitempty"` // legacy; prefer trust_badge
	ActiveSessions       int                           `json:"active_sessions,omitempty"`
	SLASource            string                        `json:"sla_source,omitempty"`
	GeoSource            string                        `json:"geo_source"`
	Geo                  *geo.MapGeoMeta               `json:"geo,omitempty"`
	ListingOfferVerified bool                          `json:"listing_offer_verified,omitempty"`
	ListingOfferHash     string                        `json:"listing_offer_hash,omitempty"`
	ProviderRegisteredOnChain bool                     `json:"provider_registered_on_chain,omitempty"`
	CatalogProduct       *models.CatalogProductSummary `json:"catalog_product,omitempty"`
}

// MarketplaceMapResponse is returned by GET /v1/marketplace/map.
type MarketplaceMapResponse struct {
	Points       []MarketplaceMapPoint `json:"points"`
	Total        int                   `json:"total"`
	ListingCount int                   `json:"listing_count"`
	NodeCount    int                   `json:"node_count"`
	BBoxApplied  bool                  `json:"bbox_applied"`
	GeneratedAt  time.Time             `json:"generated_at"`
	Discovery    DiscoveryHonesty      `json:"discovery"`
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
	ValidatorsOnly  bool
	IncludeProofs   bool
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
	Region               string     `gorm:"column:region"`
	PricePerGB           float64    `gorm:"column:price_per_gb"`
	AvailableBandwidthGB float64    `gorm:"column:available_bandwidth_gb"`
	Lat                  float64    `gorm:"column:lat"`
	Lon                  float64    `gorm:"column:lon"`
	NodeID               string     `gorm:"column:node_id"`
	NodeActive           bool       `gorm:"column:node_active"`
	UptimePercent        float64    `gorm:"column:uptime_percent"`
	LatencyMs            int        `gorm:"column:latency_ms"`
	QualityScore         float64    `gorm:"column:quality_score"`
	SuccessRate          float64    `gorm:"column:success_rate"`
	SLASource            string     `gorm:"column:sla_source"`
	GeoResolved          bool       `gorm:"column:geo_resolved"`
	ListingOfferVerified bool       `gorm:"column:listing_offer_verified"`
	ListingOfferHash     string     `gorm:"column:listing_offer_hash"`
	ListingOfferSigner   string     `gorm:"column:listing_offer_signer"`
	ListingOfferSignedAt *time.Time `gorm:"column:listing_offer_signed_at"`
	ListingOfferError    string     `gorm:"column:listing_offer_verification_error"`
	ProviderRegisteredOnChain bool  `gorm:"column:provider_registered_on_chain"`
	ProviderHasHotkey    bool       `gorm:"column:provider_has_hotkey"`
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
	QualityScore      float64    `gorm:"column:quality_score"`
	SuccessRate       float64    `gorm:"column:success_rate"`
	ConnectionType    string     `gorm:"column:connection_type"`
	Country           string     `gorm:"column:country"`
	Region            string     `gorm:"column:region"`
	City              string     `gorm:"column:city"`
	ISP               string     `gorm:"column:isp"`
	GeoSource         string     `gorm:"column:geo_source"`
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
	includeProofs := false
	// Public map never returns wallet/signer proof material.
	_ = c.Query("include_proofs")
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
		ValidatorsOnly:  c.DefaultQuery("validator", "false") == "true",
		IncludeProofs:   includeProofs,
		BBoxRaw:         strings.TrimSpace(c.Query("bbox")),
	}
}

func marketplaceMapCacheKey(c *gin.Context, filters marketplaceMapFilters) string {
	values := url.Values{}
	for key, vals := range c.Request.URL.Query() {
		if key == "bbox" {
			continue
		}
		for _, value := range vals {
			values.Add(key, value)
		}
	}
	if !values.Has("purchasable_only") && filters.PurchasableOnly {
		values.Set("purchasable_only", "true")
	}
	if !values.Has("include_proofs") {
		values.Set("include_proofs", strconv.FormatBool(filters.IncludeProofs))
	}
	if west, south, east, north, ok := parseBBox(filters.BBoxRaw); ok {
		qw, qs, qe, qn := geo.QuantizeBBox(west, south, east, north, 0.5)
		values.Set("bbox", fmt.Sprintf("%.1f,%.1f,%.1f,%.1f", qw, qs, qe, qn))
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
				resp.Discovery = discoveryHonestyMeta()
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
    COALESCE(NULLIF(pl.country, ''), NULLIF(pn.country, ''), NULLIF(en.country, ''), NULLIF(gw.country_code, '')) AS country,
    COALESCE(NULLIF(pl.isp, ''), NULLIF(pn.isp, ''), NULLIF(en.isp, ''), NULLIF(gw.isp, ''), '') AS isp,
    COALESCE(NULLIF(pn.city, ''), NULLIF(en.city, ''), NULLIF(gw.city, ''), '') AS city,
    COALESCE(NULLIF(en.region, ''), NULLIF(pn.region, ''), NULLIF(gw.region, ''), '') AS region,
    pl.price_per_gb,
    pl.available_bandwidth_gb,
    COALESCE(en.latitude, 0) AS lat,
    COALESCE(en.longitude, 0) AS lon,
    COALESCE(NULLIF(pn.id::text, ''), NULLIF(en.node_id, ''), NULLIF(n_geo.id::text, ''), NULLIF(pn.gateway_node_id, ''), NULLIF(gw.gateway_node_id, ''), '') AS node_id,
    COALESCE(gw.is_healthy, en.is_active, pn.status = 'online', false) AS node_active,
    CASE
        WHEN gw.id IS NOT NULL THEN gw.uptime_percent
        WHEN en.node_id IS NOT NULL AND COALESCE(en.uptime_percent, 0) > 0 THEN en.uptime_percent
        WHEN pn.id IS NOT NULL AND COALESCE(pn.uptime_percent, 0) > 0 THEN pn.uptime_percent
        ELSE COALESCE(pl.uptime_percent, 0)
    END AS uptime_percent,
    COALESCE(gw.latency_ms, 0) AS latency_ms,
    COALESCE(pl.quality_score, pn.quality_score, 100) AS quality_score,
    COALESCE(pl.success_rate, pn.success_rate, 100) AS success_rate,
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
    COALESCE(pl.listing_offer_hash, '') AS listing_offer_hash,
    COALESCE(pl.listing_offer_signer, '') AS listing_offer_signer,
    pl.listing_offer_signed_at AS listing_offer_signed_at,
    COALESCE(pl.listing_offer_verification_error, '') AS listing_offer_verification_error,
    COALESCE(pn.is_registered_on_chain, false) AS provider_registered_on_chain,
    COALESCE(pn.provider_has_hotkey, false) AS provider_has_hotkey,
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
        pn.quality_score,
        pn.success_rate,
        pn.city,
        pn.country,
        pn.region,
        pn.isp,
        COALESCE(pn.is_registered_on_chain, false) AS is_registered_on_chain,
        (COALESCE(TRIM(pn.hotkey), '') <> '') AS provider_has_hotkey,
        pn.latest_heartbeat_verified,
        pn.latest_heartbeat_signer,
        pn.latest_heartbeat_signed_at,
        pn.latest_heartbeat_verification_error
    FROM provider_nodes pn
    WHERE
        pn.deleted_at IS NULL
        AND (
            (pl.provider_node_id IS NOT NULL AND pn.id = pl.provider_node_id)
            OR (pl.provider_node_id IS NULL AND pn.user_id = pl.seller_id)
        )
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
    (pn.id IS NOT NULL AND en.node_id = pn.id::text)
    OR (
        pn.id IS NULL
        AND n_geo.id IS NOT NULL
        AND en.node_id = n_geo.id::text
    )
    OR (
        pn.id IS NULL
        AND n_geo.id IS NULL
        AND (pn.gateway_node_id IS NULL OR pn.gateway_node_id = '')
        AND en.provider_user_id = pl.seller_id
    )
LEFT JOIN LATERAL (
    SELECT n.id, n.gateway_node_id, n.is_healthy, n.uptime_percent, n.latency_ms, n.city, n.region, n.country_code, n.isp
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
		query += fmt.Sprintf(" AND COALESCE(NULLIF(pl.country, ''), NULLIF(pn.country, ''), NULLIF(en.country, ''), NULLIF(gw.country_code, '')) = $%d", argN)
		args = append(args, country)
		argN++
	}
	if proxyType != "" {
		query += fmt.Sprintf(" AND pl.proxy_type = $%d", argN)
		args = append(args, proxyType)
		argN++
	}
	if decentralization.BrowseRegistryFilterEnforce() {
		query += " AND COALESCE(pn.is_registered_on_chain, false) = true"
	}
	if decentralization.ListingCommitmentEnforce() {
		query += " AND COALESCE(pl.listing_commitment_on_chain, false) = true"
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
	for _, r := range rows {
		purchasable := r.AvailableBandwidthGB > 0
		anchor := geo.MapGeoAnchor(r.NodeID, r.SellerID, r.ListingID)
		lat, lon, fallbackGeo := geo.ApplyMapCoords(r.Lat, r.Lon, r.Country, r.City, r.Region, anchor)
		centroidOK := fallbackGeo != "unknown"
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
			ListingOfferHash:     r.ListingOfferHash,
			ListingOfferSigner:   r.ListingOfferSigner,
			ListingOfferSignedAt: proofTimeString(r.ListingOfferSignedAt),
			ListingOfferError:    r.ListingOfferError,
			ProviderRegisteredOnChain: r.ProviderRegisteredOnChain,
			ProviderHasHotkey:    r.ProviderHasHotkey,
			HeartbeatVerified:    r.HeartbeatVerified,
			HeartbeatSigner:      r.HeartbeatSigner,
			HeartbeatSignedAt:    proofTimeString(r.HeartbeatSignedAt),
			HeartbeatError:       r.HeartbeatError,
		})
	}

	resp := MarketplaceGeoResponse{Pins: pins, Total: len(pins), Discovery: discoveryHonestyMeta()}
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
				resp.Discovery = discoveryHonestyMeta()
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
    COALESCE(NULLIF(pl.country, ''), NULLIF(pn.country, ''), NULLIF(en.country, ''), NULLIF(gw.country_code, '')) AS country,
    COALESCE(NULLIF(pl.isp, ''), NULLIF(pn.isp, ''), NULLIF(en.isp, ''), NULLIF(gw.isp, ''), '') AS isp,
    COALESCE(NULLIF(pn.city, ''), NULLIF(en.city, ''), NULLIF(gw.city, ''), '') AS city,
    COALESCE(NULLIF(en.region, ''), NULLIF(pn.region, ''), NULLIF(gw.region, ''), '') AS region,
    pl.price_per_gb,
    pl.available_bandwidth_gb,
    COALESCE(en.latitude, 0) AS lat,
    COALESCE(en.longitude, 0) AS lon,
    COALESCE(NULLIF(pn.id::text, ''), NULLIF(en.node_id, ''), NULLIF(n_geo.id::text, ''), NULLIF(pn.gateway_node_id, ''), NULLIF(gw.gateway_node_id, ''), '') AS node_id,
    COALESCE(gw.is_healthy, en.is_active, pn.status = 'online', false) AS node_active,
    CASE
        WHEN gw.id IS NOT NULL THEN gw.uptime_percent
        WHEN en.node_id IS NOT NULL AND COALESCE(en.uptime_percent, 0) > 0 THEN en.uptime_percent
        WHEN pn.id IS NOT NULL AND COALESCE(pn.uptime_percent, 0) > 0 THEN pn.uptime_percent
        ELSE COALESCE(pl.uptime_percent, 0)
    END AS uptime_percent,
    COALESCE(gw.latency_ms, 0) AS latency_ms,
    COALESCE(pl.quality_score, pn.quality_score, 100) AS quality_score,
    COALESCE(pl.success_rate, pn.success_rate, 100) AS success_rate,
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
    COALESCE(pl.listing_offer_hash, '') AS listing_offer_hash,
    COALESCE(pl.listing_offer_signer, '') AS listing_offer_signer,
    pl.listing_offer_signed_at AS listing_offer_signed_at,
    COALESCE(pl.listing_offer_verification_error, '') AS listing_offer_verification_error,
    COALESCE(pn.is_registered_on_chain, false) AS provider_registered_on_chain,
    COALESCE(pn.provider_has_hotkey, false) AS provider_has_hotkey,
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
        pn.quality_score,
        pn.success_rate,
        pn.city,
        pn.country,
        pn.region,
        pn.isp,
        COALESCE(pn.is_registered_on_chain, false) AS is_registered_on_chain,
        (COALESCE(TRIM(pn.hotkey), '') <> '') AS provider_has_hotkey,
        pn.latest_heartbeat_verified,
        pn.latest_heartbeat_signer,
        pn.latest_heartbeat_signed_at,
        pn.latest_heartbeat_verification_error
    FROM provider_nodes pn
    WHERE
        pn.deleted_at IS NULL
        AND (
            (pl.provider_node_id IS NOT NULL AND pn.id = pl.provider_node_id)
            OR (pl.provider_node_id IS NULL AND pn.user_id = pl.seller_id)
        )
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
    (pn.id IS NOT NULL AND en.node_id = pn.id::text)
    OR (
        pn.id IS NULL
        AND n_geo.id IS NOT NULL
        AND en.node_id = n_geo.id::text
    )
    OR (
        pn.id IS NULL
        AND n_geo.id IS NULL
        AND (pn.gateway_node_id IS NULL OR pn.gateway_node_id = '')
        AND en.provider_user_id = pl.seller_id
    )
LEFT JOIN LATERAL (
    SELECT n.id, n.gateway_node_id, n.is_healthy, n.uptime_percent, n.latency_ms, n.city, n.region, n.country_code, n.isp
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
		query += fmt.Sprintf(" AND COALESCE(NULLIF(pl.country, ''), NULLIF(pn.country, ''), NULLIF(en.country, ''), NULLIF(gw.country_code, '')) = $%d", argN)
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
	if decentralization.BrowseRegistryFilterEnforce() {
		query += " AND COALESCE(pn.is_registered_on_chain, false) = true"
	}
	if decentralization.ListingCommitmentEnforce() {
		query += " AND COALESCE(pl.listing_commitment_on_chain, false) = true"
	}

	west, south, east, north, hasBBox := parseBBox(filters.BBoxRaw)
	if hasBBox {
		pw, ps, pe, pn := geo.ExpandBBox(west, south, east, north, 2.5)
		query += fmt.Sprintf(` AND (
			(
				(ABS(COALESCE(en.latitude, 0)) > 0.01 OR ABS(COALESCE(en.longitude, 0)) > 0.01)
				AND COALESCE(en.latitude, 0) BETWEEN $%d AND $%d
				AND COALESCE(en.longitude, 0) BETWEEN $%d AND $%d
			)
			OR (
				ABS(COALESCE(en.latitude, 0)) <= 0.01
				AND ABS(COALESCE(en.longitude, 0)) <= 0.01
				AND COALESCE(NULLIF(pl.country, ''), NULLIF(pn.country, ''), NULLIF(en.country, ''), NULLIF(gw.country_code, ''), '') <> ''
			)
		)`, argN, argN+1, argN+2, argN+3)
		args = append(args, ps, pn, pw, pe)
		argN += 4
	}
	query += " ORDER BY pl.status ASC, pl.created_at DESC LIMIT 5000"

	var rows []marketplaceGeoRow
	if err := db.DB.Raw(query, args...).Scan(&rows).Error; err != nil {
		logging.Error(err).Msg("[Marketplace] getMarketplaceMap query failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch marketplace map data"})
		return
	}

	points := make([]MarketplaceMapPoint, 0, len(rows))
	for _, r := range rows {
		anchor := geo.MapGeoAnchor(r.NodeID, r.SellerID, r.ListingID)
		lat, lon, fallbackGeo := geo.ApplyMapCoords(r.Lat, r.Lon, r.Country, r.City, r.Region, anchor)
		// Never publish unresolved/raw GeoIP coordinates on the public map.
		if fallbackGeo == "unknown" {
			continue
		}
		if hasBBox && !geo.PinInBBox(lat, lon, west, south, east, north) {
			continue
		}
		purchasable := r.Status == "active" && r.AvailableBandwidthGB > 0
		listingGeoSource := marketplaceGeoSource(r, fallbackGeo)
		listingGeoMeta := geo.BuildMapGeoMeta(listingGeoSource)
		networkClass := coarseNetworkClass(r.ProxyType, "")
		badge := mapTrustBadge(r.UptimePercent, r.QualityScore, r.SuccessRate, r.QualityScore >= 90)
		opaqueNode := mapOpaqueID("node", r.NodeID)
		pt := MarketplaceMapPoint{
			ID:                   "listing:" + r.ListingID,
			Kind:                 "listing",
			Latitude:             lat,
			Longitude:            lon,
			Title:                sanitizeListingMapTitle(r.Title),
			Country:              r.Country,
			City:                 r.City,
			Region:               r.Region,
			NetworkClass:         networkClass,
			Status:               r.Status,
			Purchasable:          purchasable,
			ListingID:            r.ListingID,
			NodeID:               opaqueNode,
			ProxyType:            r.ProxyType,
			Protocol:             r.Protocol,
			PricePerGB:           r.PricePerGB,
			AvailableBandwidthGB: r.AvailableBandwidthGB,
			UptimePercent:        r.UptimePercent,
			LatencyMs:            r.LatencyMs,
			QualityScore:         r.QualityScore,
			SuccessRate:          r.SuccessRate,
			TrustBadge:           badge,
			TrustLabel:           mapTrustLabel(badge),
			IsValidator:          false,
			SLASource:            r.SLASource,
			GeoSource:            listingGeoSource,
			Geo:                  &listingGeoMeta,
			ListingOfferVerified: r.ListingOfferVerified,
			ListingOfferHash:     r.ListingOfferHash,
			ProviderRegisteredOnChain: r.ProviderRegisteredOnChain,
		}
		points = append(points, pt)
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

	if includeCatalogMap(c) {
		if err := enrichMarketplaceMapCatalog(points, catalogViewerFromContext(c)); err != nil {
			logging.Error(err).Msg("[Marketplace] catalog enrich on map points failed")
		}
	}

	resp := MarketplaceMapResponse{
		Points:       points,
		Total:        len(points),
		ListingCount: listingCount,
		NodeCount:    nodeCount,
		BBoxApplied:  hasBBox,
		GeneratedAt:  time.Now().UTC(),
		Discovery:    discoveryHonestyMeta(),
	}
	cacheResponse(c, cacheKey, resp, 30*time.Second)
	c.JSON(http.StatusOK, resp)
}

func enrichMarketplaceMapCatalog(points []MarketplaceMapPoint, viewer *uuid.UUID) error {
	listingIDs := make([]uuid.UUID, 0, len(points))
	for _, p := range points {
		if p.Kind != "listing" || p.ListingID == "" {
			continue
		}
		id, err := uuid.Parse(p.ListingID)
		if err != nil {
			continue
		}
		listingIDs = append(listingIDs, id)
	}
	if len(listingIDs) == 0 {
		return nil
	}
	byListing, err := catalogsvc.SummariesByListingIDs(listingIDs, viewer)
	if err != nil {
		return err
	}
	for i := range points {
		if points[i].Kind != "listing" {
			continue
		}
		id, err := uuid.Parse(points[i].ListingID)
		if err != nil {
			continue
		}
		if summary, ok := byListing[id]; ok {
			summaryCopy := summary
			points[i].CatalogProduct = &summaryCopy
		}
	}
	return nil
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
            COALESCE(pn_live.quality_score, 100) AS quality_score,
            COALESCE(pn_live.success_rate, 100) AS success_rate,
            COALESCE(pn_live.connection_type, '') AS connection_type,
            COALESCE(
                CASE WHEN en.country IS NULL OR TRIM(en.country) = '' OR LOWER(TRIM(en.country)) = 'unknown' THEN NULL ELSE TRIM(en.country) END,
                CASE WHEN pn.country IS NULL OR TRIM(pn.country) = '' OR LOWER(TRIM(pn.country)) = 'unknown' THEN NULL ELSE TRIM(pn.country) END,
                CASE WHEN n.country_code IS NULL OR TRIM(n.country_code) = '' OR LOWER(TRIM(n.country_code)) = 'unknown' THEN NULL ELSE TRIM(n.country_code) END
            ) AS country,
            COALESCE(
                CASE WHEN en.region IS NULL OR TRIM(en.region) = '' OR LOWER(TRIM(en.region)) = 'unknown' THEN NULL ELSE TRIM(en.region) END,
                CASE WHEN pn.region IS NULL OR TRIM(pn.region) = '' OR LOWER(TRIM(pn.region)) = 'unknown' THEN NULL ELSE TRIM(pn.region) END,
                CASE WHEN n.region IS NULL OR TRIM(n.region) = '' OR LOWER(TRIM(n.region)) = 'unknown' THEN NULL ELSE TRIM(n.region) END
            ) AS region,
            COALESCE(
                CASE WHEN en.city IS NULL OR TRIM(en.city) = '' OR LOWER(TRIM(en.city)) = 'unknown' THEN NULL ELSE TRIM(en.city) END,
                CASE WHEN pn.city IS NULL OR TRIM(pn.city) = '' OR LOWER(TRIM(pn.city)) = 'unknown' THEN NULL ELSE TRIM(pn.city) END,
                CASE WHEN n.city IS NULL OR TRIM(n.city) = '' OR LOWER(TRIM(n.city)) = 'unknown' THEN NULL ELSE TRIM(n.city) END
            ) AS city,
            COALESCE(en.geo_source, '') AS geo_source,
            COALESCE(pn.latest_heartbeat_verified, false) AS heartbeat_verified,
            COALESCE(pn.latest_heartbeat_signer, '') AS heartbeat_signer,
            pn.latest_heartbeat_signed_at AS heartbeat_signed_at,
            COALESCE(pn.latest_heartbeat_verification_error, '') AS heartbeat_verification_error
        `).
		Joins(`
            LEFT JOIN provider_nodes pn_live ON pn_live.id::text = en.node_id AND pn_live.deleted_at IS NULL
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
                    pn.latest_heartbeat_verification_error,
                    pn.country,
                    pn.region,
                    pn.city,
                    pn.isp
                FROM provider_nodes pn
                WHERE
                    pn.deleted_at IS NULL
                    AND (
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
                        OR pn.id::text = en.node_id
                    )
                ORDER BY
                    CASE WHEN pn.id::text = en.node_id THEN 0 ELSE 1 END,
                    CASE WHEN pn.status = 'online' THEN 0 ELSE 1 END,
                    pn.last_seen_at DESC NULLS LAST,
                    pn.created_at DESC
                LIMIT 1
            ) pn ON TRUE
        `)
	// Never plot soft-deleted provider nodes or orphan explorer footprints.
	// Dead/deleted inventory must not appear on the public map.
	query = query.Where(`
		EXISTS (
			SELECT 1 FROM provider_nodes pn_live
			WHERE pn_live.id::text = en.node_id
			  AND pn_live.deleted_at IS NULL
		)
	`)
	if filters.ActiveNodesOnly {
		query = query.Where("en.is_active = ?", true)
		query = query.Where(`
			EXISTS (
				SELECT 1 FROM provider_nodes pn_online
				WHERE pn_online.id::text = en.node_id
				  AND pn_online.deleted_at IS NULL
				  AND (
					pn_online.status = 'online'
					OR pn_online.last_seen_at > NOW() - INTERVAL '48 hours'
				  )
			)
		`)
	} else {
		// Even when Active Only is off, hide clearly-dead inventory:
		// must be online now, or marked active with a recent heartbeat.
		query = query.Where(`
			EXISTS (
				SELECT 1 FROM provider_nodes pn_alive
				WHERE pn_alive.id::text = en.node_id
				  AND pn_alive.deleted_at IS NULL
				  AND (
					pn_alive.status = 'online'
					OR (
						en.is_active = true
						AND pn_alive.last_seen_at > NOW() - INTERVAL '48 hours'
					)
				  )
			)
		`)
	}
	if filters.ValidatorsOnly {
		query = query.Where("en.is_validator = ?", true)
	}
	if filters.Country != "" {
		query = query.Where(`
            COALESCE(
                CASE WHEN en.country IS NULL OR TRIM(en.country) = '' OR LOWER(TRIM(en.country)) = 'unknown' THEN NULL ELSE TRIM(en.country) END,
                CASE WHEN pn.country IS NULL OR TRIM(pn.country) = '' OR LOWER(TRIM(pn.country)) = 'unknown' THEN NULL ELSE TRIM(pn.country) END,
                CASE WHEN n.country_code IS NULL OR TRIM(n.country_code) = '' OR LOWER(TRIM(n.country_code)) = 'unknown' THEN NULL ELSE TRIM(n.country_code) END
            ) = ?
            OR COALESCE(
                CASE WHEN en.region IS NULL OR TRIM(en.region) = '' OR LOWER(TRIM(en.region)) = 'unknown' THEN NULL ELSE TRIM(en.region) END,
                CASE WHEN pn.region IS NULL OR TRIM(pn.region) = '' OR LOWER(TRIM(pn.region)) = 'unknown' THEN NULL ELSE TRIM(pn.region) END,
                CASE WHEN n.region IS NULL OR TRIM(n.region) = '' OR LOWER(TRIM(n.region)) = 'unknown' THEN NULL ELSE TRIM(n.region) END
            ) = ?
        `, filters.Country, filters.Country)
	}
	if filters.MinUptime != nil {
		query = query.Where("en.uptime_percent >= ?", *filters.MinUptime)
	}
	if hasBBox {
		pw, ps, pe, pn := geo.ExpandBBox(west, south, east, north, 2.5)
		query = query.Where(`
            (
                (ABS(COALESCE(en.latitude, 0)) > 0.01 OR ABS(COALESCE(en.longitude, 0)) > 0.01)
                AND COALESCE(en.latitude, 0) BETWEEN ? AND ?
                AND COALESCE(en.longitude, 0) BETWEEN ? AND ?
            )
            OR (
                ABS(COALESCE(en.latitude, 0)) <= 0.01
                AND ABS(COALESCE(en.longitude, 0)) <= 0.01
                AND COALESCE(NULLIF(TRIM(en.country), ''), NULLIF(TRIM(pn.country), ''), NULLIF(TRIM(n.country_code), ''), '') <> ''
            )
        `, ps, pn, pw, pe)
	}

	var rows []marketplaceMapNodeRow
	if err := query.Order("en.is_active DESC, en.uptime_percent DESC").Limit(5000).Scan(&rows).Error; err != nil {
		return nil, err
	}

	points := make([]MarketplaceMapPoint, 0, len(rows))
	for _, r := range rows {
		country := normalizeMarketplaceMapCountry(r.Country)
		region := normalizeMarketplaceMapText(r.Region)
		city := normalizeMarketplaceMapText(r.City)
		anchor := geo.MapGeoAnchor(r.NodeID, "", "")
		lat, lon, fallbackGeo := geo.ApplyMapCoords(r.Lat, r.Lon, country, city, region, anchor)
		if fallbackGeo == "unknown" {
			continue
		}
		if hasBBox && !geo.PinInBBox(lat, lon, west, south, east, north) {
			continue
		}
		status := "offline"
		if r.IsActive {
			status = "active"
		}
		networkClass := coarseNetworkClass("", r.ConnectionType)
		badge := mapTrustBadge(r.UptimePercent, r.QualityScore, r.SuccessRate, r.IsValidator || r.QualityScore >= 90)
		opaqueNode := mapOpaqueID("node", r.NodeID)
		nodeGeoSource := fallbackGeo
		if nodeGeoSource == "" || nodeGeoSource == "unknown" {
			nodeGeoSource = nodeMapGeoSource(r.GeoSource, country, city, region, r.Lat, r.Lon, fallbackGeo)
		}
		if nodeGeoSource == "unknown" {
			continue
		}
		nodeGeoMeta := geo.BuildMapGeoMeta(nodeGeoSource)
		pt := MarketplaceMapPoint{
			ID:                   "node:" + opaqueNode,
			Kind:                 "node",
			Latitude:             lat,
			Longitude:            lon,
			Title:                privacyNodeTitle(city, country, networkClass),
			Country:              country,
			Region:               region,
			City:                 city,
			NetworkClass:         networkClass,
			Status:               status,
			Purchasable:          false,
			NodeID:               opaqueNode,
			UptimePercent:        r.UptimePercent,
			QualityScore:         r.QualityScore,
			SuccessRate:          r.SuccessRate,
			TrustBadge:           badge,
			TrustLabel:           mapTrustLabel(badge),
			IsValidator:          r.IsValidator,
			ActiveSessions:       r.ActiveSessions,
			GeoSource:            nodeGeoSource,
			Geo:                  &nodeGeoMeta,
			AvailableBandwidthGB: 0,
		}
		points = append(points, pt)
	}
	return points, nil
}

func nodeMapGeoSource(stored, country, city, region string, rawLat, rawLon float64, fallbackGeo string) string {
	if src := strings.TrimSpace(stored); src != "" {
		return src
	}
	return geo.ResolveNodeMapGeoSource(country, city, region, rawLat, rawLon, fallbackGeo)
}

// marketplaceGeoSource remaps exact GPS-like labels to privacy-safe hub/centroid sources.
// Public marketplace pins are regional hubs, never street-level GPS.
func marketplaceGeoSource(row marketplaceGeoRow, candidate string) string {
	src := strings.ToLower(strings.TrimSpace(candidate))
	switch src {
	case "region_hub", "city_centroid", "country_centroid", "unknown":
		return src
	}

	country := normalizeMarketplaceMapCountry(row.Country)
	city := normalizeMarketplaceMapText(row.City)
	region := normalizeMarketplaceMapText(row.Region)

	// gps/explorer/gateway/provider (and empty) must not leak as precise coordinates.
	if src == "gps" || src == "explorer" || src == "gateway" || src == "provider" || src == "" {
		if _, _, _, ok := geo.ApplyRegionalHubCoords(country, city, region, 0, 0); ok {
			return "region_hub"
		}
		if _, _, ok := geo.CityCentroid(city, country); ok {
			return "city_centroid"
		}
		if country != "" {
			return "country_centroid"
		}
		return "unknown"
	}

	if src != "" {
		return src
	}
	return "unknown"
}

func normalizeMarketplaceMapCountry(country string) string {
	return geo.NormalizeCountryCode(country)
}

func normalizeMarketplaceMapText(value string) string {
	value = strings.TrimSpace(value)
	switch strings.ToLower(value) {
	case "", "unknown", "n/a", "na", "-", "—":
		return ""
	default:
		return value
	}
}
