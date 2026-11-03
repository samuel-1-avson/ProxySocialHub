package api

import (
	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	geo "github.com/proxyhubb/control-api/internal/geo"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
	"net/http"
)

// Keep old URLs explicit without maintaining a second, less private contract.
func retiredMarketplaceGeo(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusGone, gin.H{"error": "endpoint_retired", "replacement": "/v1/marketplace/map"})
}

func publicMapCoords(lat, lon float64, country, city, region, anchor, precision string) (float64, float64, string) {
	if precision != "city" {
		if a, b, ok := geo.CountryCentroid(country, ""); ok {
			return a, b, "country_centroid"
		}
		return 0, 0, "unknown"
	}
	a, b, source := geo.ApplyMapCoords(lat, lon, country, city, region, anchor)
	if source == "unknown" {
		return 0, 0, source
	}
	return a, b, source
}

func explorerPrivacyQuery(q *gorm.DB) *gorm.DB {
	return q.Where(`EXISTS (SELECT 1 FROM profiles privacy_owner WHERE privacy_owner.map_visible = true AND
	 (privacy_owner.id::text = explorer_nodes.provider_user_id::text OR EXISTS
	 (SELECT 1 FROM provider_nodes privacy_node WHERE privacy_node.id::text = explorer_nodes.node_id
	 AND privacy_node.user_id = privacy_owner.id AND privacy_node.deleted_at IS NULL)))`)
}

func publicExplorerNodeVisible(id string) bool {
	if db.DB == nil {
		return false
	}
	var n int64
	return explorerPrivacyQuery(db.DB.Model(&models.ExplorerNode{})).Where("node_id = ?", id).Count(&n).Error == nil && n > 0
}

func opaqueNodeSQL() string {
	return "encode(substring(sha256(convert_to('node:' || node_id, 'UTF8')) from 1 for 8), 'hex')"
}
