package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	geo "github.com/proxyhubb/control-api/internal/geo"
)

// MapHealthResponse summarizes map/geo readiness for operators and dashboards.
type MapHealthResponse struct {
	GeneratedAt   time.Time              `json:"generated_at"`
	ExplorerNodes MapHealthExplorerNodes `json:"explorer_nodes"`
	Listings      MapHealthListings      `json:"listings"`
	RegionalHubs  MapHealthRegionalHubs  `json:"regional_hubs"`
}

type MapHealthExplorerNodes struct {
	Total             int     `json:"total"`
	Active            int     `json:"active"`
	WithNonzeroCoords int     `json:"with_nonzero_coords"`
	ZeroCoords        int     `json:"zero_coords"`
	ZeroCoordsPct     float64 `json:"zero_coords_pct"`
}

type MapHealthListings struct {
	Active               int `json:"active"`
	Purchasable          int `json:"purchasable"`
	WithCountry          int `json:"with_country"`
	WithExplorerCoords   int `json:"with_explorer_coords"`
	WithoutResolvableGeo int `json:"without_resolvable_geo"`
}

type MapHealthRegionalHubs struct {
	Countries int `json:"countries"`
	Hubs      int `json:"hubs"`
}

func getMapHealth(c *gin.Context) {
	countries, hubs := geo.RegionalHubStats()
	resp := MapHealthResponse{
		GeneratedAt: time.Now().UTC(),
		RegionalHubs: MapHealthRegionalHubs{
			Countries: countries,
			Hubs:      hubs,
		},
	}

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":          "Database not available",
			"generated_at":   resp.GeneratedAt,
			"regional_hubs":  resp.RegionalHubs,
		})
		return
	}

	var nodeRow struct {
		Total      int64 `gorm:"column:total"`
		Active     int64 `gorm:"column:active"`
		WithCoords int64 `gorm:"column:with_coords"`
	}
	if err := db.DB.Raw(`
SELECT
  COUNT(*)::bigint AS total,
  COUNT(*) FILTER (WHERE is_active)::bigint AS active,
  COUNT(*) FILTER (WHERE ABS(latitude) > 0.01 OR ABS(longitude) > 0.01)::bigint AS with_coords
FROM explorer_nodes
`).Scan(&nodeRow).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read explorer node geo stats"})
		return
	}

	zero := nodeRow.Total - nodeRow.WithCoords
	var zeroPct float64
	if nodeRow.Total > 0 {
		zeroPct = float64(zero) / float64(nodeRow.Total) * 100
	}
	resp.ExplorerNodes = MapHealthExplorerNodes{
		Total:             int(nodeRow.Total),
		Active:            int(nodeRow.Active),
		WithNonzeroCoords: int(nodeRow.WithCoords),
		ZeroCoords:        int(zero),
		ZeroCoordsPct:     zeroPct,
	}

	var listingRow struct {
		Active             int64 `gorm:"column:active"`
		Purchasable        int64 `gorm:"column:purchasable"`
		WithCountry        int64 `gorm:"column:with_country"`
		WithExplorerCoords int64 `gorm:"column:with_explorer_coords"`
		WithoutResolvable  int64 `gorm:"column:without_resolvable_geo"`
	}
	if err := db.DB.Raw(`
SELECT
  COUNT(*) FILTER (WHERE pl.status = 'active')::bigint AS active,
  COUNT(*) FILTER (WHERE pl.status = 'active' AND pl.available_bandwidth_gb > 0)::bigint AS purchasable,
  COUNT(*) FILTER (WHERE pl.status = 'active' AND COALESCE(NULLIF(TRIM(pl.country), ''), NULLIF(TRIM(pn.country), '')) IS NOT NULL)::bigint AS with_country,
  COUNT(*) FILTER (WHERE pl.status = 'active' AND (
    ABS(en.latitude) > 0.01 OR ABS(en.longitude) > 0.01
  ))::bigint AS with_explorer_coords,
  COUNT(*) FILTER (WHERE pl.status = 'active' AND NOT (
    ABS(en.latitude) > 0.01 OR ABS(en.longitude) > 0.01
    OR COALESCE(NULLIF(TRIM(pl.country), ''), NULLIF(TRIM(pn.country), '')) IS NOT NULL
  ))::bigint AS without_resolvable_geo
FROM proxy_listings pl
LEFT JOIN LATERAL (
    SELECT pn.id, pn.country
    FROM provider_nodes pn
    WHERE
        (pl.provider_node_id IS NOT NULL AND pn.id = pl.provider_node_id)
        OR (pl.provider_node_id IS NULL AND pn.user_id = pl.seller_id)
    ORDER BY
        CASE WHEN pl.provider_node_id IS NOT NULL AND pn.id = pl.provider_node_id THEN 0 ELSE 1 END,
        pn.last_seen_at DESC NULLS LAST
    LIMIT 1
) pn ON TRUE
LEFT JOIN explorer_nodes en ON pn.id IS NOT NULL AND en.node_id = pn.id::text
`).Scan(&listingRow).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read listing geo stats"})
		return
	}

	resp.Listings = MapHealthListings{
		Active:               int(listingRow.Active),
		Purchasable:          int(listingRow.Purchasable),
		WithCountry:          int(listingRow.WithCountry),
		WithExplorerCoords:   int(listingRow.WithExplorerCoords),
		WithoutResolvableGeo: int(listingRow.WithoutResolvable),
	}

	c.JSON(http.StatusOK, resp)
}
