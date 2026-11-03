package topology

import (
	"log"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	geo "github.com/proxyhubb/control-api/internal/geo"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm/clause"
)

type sessionAggRow struct {
	ProviderNodeID string
	TargetGeo      string
	ListingCountry string
	Count          int
	BytesUp        int64
	BytesDown      int64
}

type providerGeoRow struct {
	ID        string
	Country   string
	City      string
	Region    string
	LatencyMs int
	Lat       float64
	Lon       float64
}

type aggKey struct {
	SourceID string
	TargetID string
}

type aggBucket struct {
	source         RegionEndpoint
	target         RegionEndpoint
	activeSessions int
	bytesUp        int64
	bytesDown      int64
	latencySamples []int
}

// AggregateSessionLinks rolls up active session intents into map_node_links rows.
func AggregateSessionLinks(now time.Time) (int, error) {
	if db.DB == nil {
		return 0, nil
	}

	windowStart := now.UTC().Truncate(time.Hour)
	windowEnd := windowStart.Add(time.Hour)

	if err := pruneStaleLinks(now); err != nil {
		return 0, err
	}

	rows, err := loadSessionAggRows()
	if err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		if err := db.DB.Where("link_kind = ? AND window_start = ?", models.MapLinkKindSessionAggregate, windowStart).
			Delete(&models.MapNodeLink{}).Error; err != nil {
			return 0, err
		}
		return 0, nil
	}

	providerIDs := uniqueProviderIDs(rows)
	providers, err := loadProviderGeo(providerIDs)
	if err != nil {
		return 0, err
	}

	buckets := map[aggKey]*aggBucket{}
	for _, row := range rows {
		prov, ok := providers[row.ProviderNodeID]
		if !ok {
			continue
		}
		source, ok := ResolveRegionEndpoint(prov.Country, "", "", 0, 0, "country:"+prov.Country)
		if !ok {
			continue
		}
		target, ok := ResolveTargetGeoEndpoint(row.TargetGeo, row.ListingCountry)
		if !ok {
			continue
		}
		if source.ID == target.ID {
			continue
		}

		key := aggKey{SourceID: source.ID, TargetID: target.ID}
		b, exists := buckets[key]
		if !exists {
			b = &aggBucket{source: source, target: target}
			buckets[key] = b
		}
		b.activeSessions += row.Count
		b.bytesUp += row.BytesUp
		b.bytesDown += row.BytesDown
		if prov.LatencyMs > 0 {
			for i := 0; i < row.Count; i++ {
				b.latencySamples = append(b.latencySamples, prov.LatencyMs)
			}
		}
	}

	links := make([]models.MapNodeLink, 0, len(buckets))
	for _, b := range buckets {
		if b.activeSessions < 5 {
			continue
		}
		p50, p95 := percentileLatency(b.latencySamples)
		link := models.MapNodeLink{
			ID:             uuid.New(),
			LinkKind:       models.MapLinkKindSessionAggregate,
			SourceKind:     b.source.Kind,
			SourceID:       b.source.ID,
			SourceLat:      b.source.Lat,
			SourceLon:      b.source.Lon,
			TargetKind:     b.target.Kind,
			TargetID:       b.target.ID,
			TargetLat:      b.target.Lat,
			TargetLon:      b.target.Lon,
			ActiveSessions: b.activeSessions,
			BytesUp1h:      b.bytesUp,
			BytesDown1h:    b.bytesDown,
			GeoPrecision:   models.MapLinkGeoPrecisionRegion,
			Provenance:     models.MapLinkProvenanceSession,
			WindowStart:    windowStart,
			WindowEnd:      windowEnd,
			UpdatedAt:      now.UTC(),
		}
		if p50 > 0 {
			link.LatencyMsP50 = &p50
		}
		if p95 > 0 {
			link.LatencyMsP95 = &p95
		}
		links = append(links, link)
	}

	tx := db.DB.Begin()
	if tx.Error != nil {
		return 0, tx.Error
	}
	if err := tx.Where("link_kind = ? AND window_start = ?", models.MapLinkKindSessionAggregate, windowStart).
		Delete(&models.MapNodeLink{}).Error; err != nil {
		tx.Rollback()
		return 0, err
	}
	if len(links) > 0 {
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "link_kind"},
				{Name: "source_id"},
				{Name: "target_id"},
				{Name: "window_start"},
			},
			DoUpdates: clause.AssignmentColumns([]string{
				"active_sessions", "bytes_up_1h", "bytes_down_1h",
				"latency_ms_p50", "latency_ms_p95", "updated_at",
				"source_lat", "source_lon", "target_lat", "target_lon",
			}),
		}).Create(&links).Error; err != nil {
			tx.Rollback()
			return 0, err
		}
	}
	if err := tx.Commit().Error; err != nil {
		return 0, err
	}

	log.Printf("[MapTopology] aggregated %d session links for window %s", len(links), windowStart.Format(time.RFC3339))
	return len(links), nil
}

func pruneStaleLinks(now time.Time) error {
	cutoff := now.UTC().Add(-24 * time.Hour)
	return db.DB.Where("window_end < ?", cutoff).Delete(&models.MapNodeLink{}).Error
}

func loadSessionAggRows() ([]sessionAggRow, error) {
	const q = `
SELECT
    si.provider_node_id,
    COALESCE(si.target_geo, '') AS target_geo,
    COALESCE(pl.country, '') AS listing_country,
    COUNT(*)::int AS count,
    COALESCE(SUM(si.total_bytes_up), 0)::bigint AS bytes_up,
    COALESCE(SUM(si.total_bytes_down), 0)::bigint AS bytes_down
FROM session_intents si
LEFT JOIN proxy_listings pl ON pl.id = si.listing_id
JOIN profiles buyer_privacy ON buyer_privacy.id = si.user_id AND buyer_privacy.activity_public = true
JOIN provider_nodes provider_privacy ON provider_privacy.id::text = si.provider_node_id
JOIN profiles seller_privacy ON seller_privacy.id = provider_privacy.user_id AND seller_privacy.map_visible = true
WHERE si.deleted_at IS NULL
  AND si.lifecycle_state IN ('routed', 'active')
  AND si.provider_node_id IS NOT NULL
  AND TRIM(si.provider_node_id) <> ''
GROUP BY si.provider_node_id, si.target_geo, pl.country`

	var rows []sessionAggRow
	if err := db.DB.Raw(q).Scan(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func loadProviderGeo(providerIDs []string) (map[string]providerGeoRow, error) {
	out := make(map[string]providerGeoRow, len(providerIDs))
	if len(providerIDs) == 0 {
		return out, nil
	}

	type row struct {
		ID        string  `gorm:"column:id"`
		Country   string  `gorm:"column:country"`
		City      string  `gorm:"column:city"`
		Region    string  `gorm:"column:region"`
		LatencyMs int     `gorm:"column:latency_ms"`
		Lat       float64 `gorm:"column:latitude"`
		Lon       float64 `gorm:"column:longitude"`
	}

	var rows []row
	err := db.DB.Raw(`
SELECT
    pn.id::text AS id,
    COALESCE(pn.country, '') AS country,
    COALESCE(pn.city, '') AS city,
    COALESCE(pn.region, '') AS region,
    COALESCE(pn.latency_ms, 0) AS latency_ms,
    COALESCE(en.latitude, 0) AS latitude,
    COALESCE(en.longitude, 0) AS longitude
FROM provider_nodes pn
LEFT JOIN explorer_nodes en ON en.node_id = pn.id::text
WHERE pn.id::text IN ?
  AND pn.deleted_at IS NULL`, providerIDs).Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	for _, r := range rows {
		out[r.ID] = providerGeoRow{
			ID:        r.ID,
			Country:   r.Country,
			City:      r.City,
			Region:    r.Region,
			LatencyMs: r.LatencyMs,
			Lat:       r.Lat,
			Lon:       r.Lon,
		}
	}
	return out, nil
}

func uniqueProviderIDs(rows []sessionAggRow) []string {
	seen := make(map[string]struct{}, len(rows))
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		id := strings.TrimSpace(row.ProviderNodeID)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}

func percentileLatency(samples []int) (p50, p95 int) {
	if len(samples) == 0 {
		return 0, 0
	}
	sort.Ints(samples)
	p50 = samples[len(samples)/2]
	idx95 := int(math.Ceil(float64(len(samples))*0.95)) - 1
	if idx95 < 0 {
		idx95 = 0
	}
	if idx95 >= len(samples) {
		idx95 = len(samples) - 1
	}
	p95 = samples[idx95]
	return p50, p95
}

// ListLinksQuery filters materialized topology rows for the public API.
type ListLinksQuery struct {
	Kinds       []string
	MinSessions int
	Limit       int
	BBox        *BBox
}

// BBox is west,south,east,north in degrees.
type BBox struct {
	West, South, East, North float64
}

// ListLinks returns the latest window links matching filters.
func ListLinks(q ListLinksQuery) ([]models.MapNodeLink, bool, error) {
	if db.DB == nil {
		return nil, false, nil
	}

	var count int64
	if err := db.DB.Model(&models.MapNodeLink{}).Count(&count).Error; err != nil {
		return nil, false, err
	}
	if count == 0 {
		return nil, false, nil
	}

	limit := q.Limit
	if limit <= 0 || limit > 50 {
		limit = 50
	}
	minSessions := q.MinSessions
	if minSessions < 1 {
		minSessions = 1
	}

	kinds := q.Kinds
	if len(kinds) == 0 {
		kinds = []string{models.MapLinkKindSessionAggregate}
	}

	var windowEnd time.Time
	if err := db.DB.Model(&models.MapNodeLink{}).
		Select("MAX(window_end)").
		Scan(&windowEnd).Error; err != nil {
		return nil, false, err
	}
	if windowEnd.IsZero() {
		return nil, false, nil
	}

	query := db.DB.Where("window_end = ? AND active_sessions >= ?", windowEnd, minSessions)
	query = query.Where("link_kind IN ?", kinds)
	query = query.Order("active_sessions DESC").Limit(limit)

	var links []models.MapNodeLink
	if err := query.Find(&links).Error; err != nil {
		return nil, false, err
	}

	if q.BBox != nil {
		links = filterLinksByBBox(links, *q.BBox)
	}

	links = filterLinksWithGlobeCoords(links)

	return links, true, nil
}

func filterLinksWithGlobeCoords(links []models.MapNodeLink) []models.MapNodeLink {
	out := make([]models.MapNodeLink, 0, len(links))
	for _, l := range links {
		if geo.IsGlobeCoord(l.SourceLat, l.SourceLon) && geo.IsGlobeCoord(l.TargetLat, l.TargetLon) {
			out = append(out, l)
		}
	}
	return out
}

func filterLinksByBBox(links []models.MapNodeLink, box BBox) []models.MapNodeLink {
	out := make([]models.MapNodeLink, 0, len(links))
	for _, l := range links {
		if pointInBBox(l.SourceLat, l.SourceLon, box) && pointInBBox(l.TargetLat, l.TargetLon, box) {
			out = append(out, l)
		}
	}
	return out
}

func pointInBBox(lat, lon float64, box BBox) bool {
	if lat < box.South || lat > box.North {
		return false
	}
	if box.West <= box.East {
		return lon >= box.West && lon <= box.East
	}
	return lon >= box.West || lon <= box.East
}
