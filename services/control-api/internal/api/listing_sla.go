package api

import (
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

type listingSLARow struct {
	ListingID     string  `gorm:"column:listing_id"`
	UptimePercent float64 `gorm:"column:uptime_percent"`
	LatencyMs     int     `gorm:"column:latency_ms"`
	SLASource     string  `gorm:"column:sla_source"`
}

// enrichListingsSLA overwrites uptime/latency on listings with live gateway → explorer → provider precedence.
func enrichListingsSLA(listings []models.ProxyListing) {
	enrichListingsQuality(listings)
	if len(listings) == 0 {
		return
	}
	ids := make([]uuid.UUID, len(listings))
	for i, l := range listings {
		ids[i] = l.ID
	}

	const q = `
SELECT
    pl.id::text AS listing_id,
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
    END AS sla_source
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
        -- provider_user_id is uuid in migrated databases (varchar in AutoMigrate-era
        -- ones); comparing as text works for both, uuid = text does not.
        AND en.provider_user_id::text = pl.seller_id::text
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
WHERE pl.id IN ?`

	var rows []listingSLARow
	if err := db.DB.Raw(q, ids).Scan(&rows).Error; err != nil {
		return
	}
	byID := make(map[string]listingSLARow, len(rows))
	for _, r := range rows {
		byID[r.ListingID] = r
	}
	for i := range listings {
		if listings[i].QualityAssessmentID != nil {
			listings[i].SLASource = "assessment"
			continue
		}
		row, ok := byID[listings[i].ID.String()]
		if !ok {
			continue
		}
		listings[i].UptimePercent = row.UptimePercent
		if row.LatencyMs > 0 {
			listings[i].AvgLatencyMs = row.LatencyMs
		}
		listings[i].SLASource = row.SLASource
	}
}
