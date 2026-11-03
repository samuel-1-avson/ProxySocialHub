package api

import (
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	geo "github.com/proxyhubb/control-api/internal/geo"
	"github.com/proxyhubb/control-api/internal/map/topology"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterMapTopologyRoutes registers topology link endpoints.
func RegisterMapTopologyRoutes(rg *gin.RouterGroup) {
	limit := RateLimitWithConfig(30, time.Minute)
	rg.GET("/map/links", limit, getMapLinks)
}

type mapLinkEndpoint struct {
	ID    string  `json:"id"`
	Label string  `json:"label"`
	Lat   float64 `json:"lat"`
	Lon   float64 `json:"lon"`
}

type mapLinkResponse struct {
	ID             string          `json:"id"`
	Kind           string          `json:"kind"`
	Source         mapLinkEndpoint `json:"source"`
	Target         mapLinkEndpoint `json:"target"`
	ActiveSessions int             `json:"active_sessions"`
	LatencyMs      int             `json:"latency_ms"`
	StrokeWidth    float64         `json:"stroke_width"`
	Color          string          `json:"color"`
	GeoPrecision   string          `json:"geo_precision"`
	Provenance     string          `json:"provenance"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

type mapLinksMeta struct {
	Count             int  `json:"count"`
	WindowMinutes     int  `json:"window_minutes"`
	TopologyAvailable bool `json:"topology_available"`
}

type mapLinksResponse struct {
	Links []mapLinkResponse `json:"links"`
	Meta  mapLinksMeta      `json:"meta"`
}

func getMapLinks(c *gin.Context) {
	if os.Getenv("PUBLIC_TOPOLOGY_ENABLED") != "true" {
		c.Header("Cache-Control", "no-store")
		c.JSON(200, mapLinksResponse{Links: []mapLinkResponse{}, Meta: mapLinksMeta{WindowMinutes: 60, TopologyAvailable: false}})
		return
	}
	c.Header("Cache-Control", "no-store")
	minSessions := 5
	if raw := strings.TrimSpace(c.Query("min_sessions")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v >= 5 {
			minSessions = v
		}
	}

	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			limit = v
		}
	}

	kinds := []string{models.MapLinkKindSessionAggregate}
	var bbox *topology.BBox
	if box, ok := parseMapLinksBBox(c.Query("bbox")); ok {
		bbox = &box
	}

	rows, available, err := topology.ListLinks(topology.ListLinksQuery{
		Kinds:       kinds,
		MinSessions: minSessions,
		Limit:       limit,
		BBox:        bbox,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load map links"})
		return
	}

	links := make([]mapLinkResponse, 0, len(rows))
	for _, row := range rows {
		if row.LinkKind != models.MapLinkKindSessionAggregate || row.ActiveSessions < 5 || row.SourceKind != "region" || row.TargetKind != "region" {
			continue
		}
		if !geo.IsGlobeCoord(row.SourceLat, row.SourceLon) || !geo.IsGlobeCoord(row.TargetLat, row.TargetLon) {
			continue
		}
		links = append(links, toMapLinkResponse(row))
	}

	c.JSON(http.StatusOK, mapLinksResponse{
		Links: links,
		Meta: mapLinksMeta{
			Count:             len(links),
			WindowMinutes:     60,
			TopologyAvailable: available,
		},
	})
}

func parseKindsParam(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []string{models.MapLinkKindSessionAggregate}
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if k := strings.TrimSpace(p); k != "" {
			out = append(out, k)
		}
	}
	if len(out) == 0 {
		return []string{models.MapLinkKindSessionAggregate}
	}
	return out
}

func parseMapLinksBBox(raw string) (topology.BBox, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return topology.BBox{}, false
	}
	parts := strings.Split(raw, ",")
	if len(parts) != 4 {
		return topology.BBox{}, false
	}
	vals := make([]float64, 4)
	for i, p := range parts {
		v, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil {
			return topology.BBox{}, false
		}
		vals[i] = v
	}
	return topology.BBox{
		West:  vals[0],
		South: vals[1],
		East:  vals[2],
		North: vals[3],
	}, true
}

func toMapLinkResponse(row models.MapNodeLink) mapLinkResponse {
	latency := 0
	if row.LatencyMsP50 != nil {
		latency = *row.LatencyMsP50
	}
	visual := topology.VisualForLink(latency, row.ActiveSessions)
	return mapLinkResponse{
		ID:   row.ID.String(),
		Kind: row.LinkKind,
		Source: mapLinkEndpoint{
			ID:    row.SourceID,
			Label: topology.LabelFromRegionID(row.SourceID),
			Lat:   row.SourceLat,
			Lon:   row.SourceLon,
		},
		Target: mapLinkEndpoint{
			ID:    row.TargetID,
			Label: topology.LabelFromRegionID(row.TargetID),
			Lat:   row.TargetLat,
			Lon:   row.TargetLon,
		},
		ActiveSessions: row.ActiveSessions,
		LatencyMs:      latency,
		StrokeWidth:    visual.StrokeWidth,
		Color:          visual.Color,
		GeoPrecision:   row.GeoPrecision,
		Provenance:     row.Provenance,
		UpdatedAt:      row.UpdatedAt,
	}
}
