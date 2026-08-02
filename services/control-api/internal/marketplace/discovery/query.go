package discovery

import (
	"strings"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// Query is the shared filter model for listing browse and legacy service discovery.
type Query struct {
	Page  int
	Limit int

	ProxyType    string
	Protocol     string
	RotationType string
	Country      string
	ISP          string
	SellerID     uuid.UUID

	MinPrice         float64
	MaxPrice         float64
	MinPriceSet      bool
	MaxPriceSet      bool
	MinRating        float64
	MinRatingSet     bool
	MinQualityScore  float64
	MinQualitySet    bool
	MinSuccessRate   float64
	MinSuccessSet    bool
	MinUptimePercent float64
	MinUptimeSet     bool

	SortBy    string
	SortOrder string

	// Service-configuration dimensions (require nodes + service_configurations join).
	Protocols                 []string
	TargetCountries           []string
	MinBandwidthMbps          int
	PriorityTier              string
	RequireCaptchaSolving     bool
	RequireJsRendering        bool
	RequireBrowserFingerprint bool
	RequireStickySession      bool
	RequireAutoRotation       bool
}

// NeedsServiceConfigJoin reports whether filters reference service_configurations columns.
func (q Query) NeedsServiceConfigJoin() bool {
	if len(q.Protocols) > 0 || q.MinBandwidthMbps > 0 || q.PriorityTier != "" {
		return true
	}
	return q.RequireCaptchaSolving ||
		q.RequireJsRendering ||
		q.RequireBrowserFingerprint ||
		q.RequireStickySession ||
		q.RequireAutoRotation
}

// BaseQuery returns an active-listing query scoped to proxy_listings.
func BaseQuery(db *gorm.DB) *gorm.DB {
	return db.Model(&models.ProxyListing{}).
		Where("proxy_listings.status = ?", models.ListingStatusActive)
}

const (
	nodesJoinClause = "LEFT JOIN nodes n ON n.provider_node_id = proxy_listings.provider_node_id"
	serviceConfigJoinClause = "LEFT JOIN service_configurations sc ON sc.node_id = n.id AND COALESCE(sc.is_active, true) = true"
)

// ApplyServiceConfigJoin links listings → provider_nodes → nodes → service_configurations.
func ApplyServiceConfigJoin(query *gorm.DB) *gorm.DB {
	return query.Joins(nodesJoinClause).Joins(serviceConfigJoinClause)
}

// Apply applies listing and optional service-configuration filters to query.
func Apply(query *gorm.DB, q Query) *gorm.DB {
	if q.NeedsServiceConfigJoin() {
		query = ApplyServiceConfigJoin(query)
	}

	if q.ProxyType != "" {
		query = query.Where("proxy_listings.proxy_type = ?", q.ProxyType)
	}
	if q.Protocol != "" {
		query = query.Where("LOWER(proxy_listings.protocol) = LOWER(?)", q.Protocol)
	}
	if q.RotationType != "" {
		query = query.Where("LOWER(proxy_listings.rotation_type) = LOWER(?)", q.RotationType)
	}

	country := q.Country
	if country == "" && len(q.TargetCountries) == 1 {
		country = q.TargetCountries[0]
	}
	if country != "" {
		query = query.Where("LOWER(proxy_listings.country) = LOWER(?)", country)
	} else if len(q.TargetCountries) > 1 {
		lowered := make([]string, 0, len(q.TargetCountries))
		for _, c := range q.TargetCountries {
			if c == "" {
				continue
			}
			lowered = append(lowered, strings.ToLower(c))
		}
		if len(lowered) > 0 {
			query = query.Where("LOWER(proxy_listings.country) IN ?", lowered)
		}
	}

	if q.ISP != "" {
		query = query.Where("proxy_listings.isp ILIKE ?", "%"+q.ISP+"%")
	}
	if q.SellerID != uuid.Nil {
		query = query.Where("proxy_listings.seller_id = ?", q.SellerID)
	}
	if q.MinPriceSet {
		query = query.Where("proxy_listings.price_per_gb >= ?", q.MinPrice)
	}
	if q.MaxPriceSet {
		query = query.Where("proxy_listings.price_per_gb <= ?", q.MaxPrice)
	}
	if q.MinRatingSet {
		if q.MinRating <= 5 {
			query = query.Joins("LEFT JOIN profiles seller_profiles ON seller_profiles.id = proxy_listings.seller_id").
				Where("COALESCE(seller_profiles.avg_rating, 0) >= ?", q.MinRating)
		} else {
			query = query.Where("proxy_listings.quality_score >= ?", q.MinRating)
		}
	}
	if q.MinQualitySet {
		query = query.Where("proxy_listings.quality_score >= ?", q.MinQualityScore)
	}
	if q.MinSuccessSet {
		query = query.Where("proxy_listings.success_rate >= ?", q.MinSuccessRate)
	}
	if q.MinUptimeSet {
		query = query.Where("proxy_listings.uptime_percent >= ?", q.MinUptimePercent)
	}

	query = applyProtocolFilters(query, q.Protocols)
	if q.MinBandwidthMbps > 0 {
		query = query.Where("COALESCE(sc.max_bandwidth_mbps, 100) >= ?", q.MinBandwidthMbps)
	}
	if q.PriorityTier != "" {
		query = query.Where("COALESCE(sc.priority_tier, 'standard') = ?", q.PriorityTier)
	}
	if q.RequireCaptchaSolving {
		query = query.Where("sc.captcha_solving_enabled = true")
	}
	if q.RequireJsRendering {
		query = query.Where("sc.javascript_render_enabled = true")
	}
	if q.RequireBrowserFingerprint {
		query = query.Where("sc.browser_fingerprint_enabled = true")
	}
	if q.RequireStickySession {
		query = query.Where("COALESCE(sc.supports_sticky_session, true) = true")
	}
	if q.RequireAutoRotation {
		query = query.Where("COALESCE(sc.supports_auto_rotation, true) = true")
	}

	return query
}

func applyProtocolFilters(query *gorm.DB, protocols []string) *gorm.DB {
	if len(protocols) == 0 {
		return query
	}
	conditions := make([]string, 0, len(protocols))
	for _, p := range protocols {
		switch strings.ToLower(strings.TrimSpace(p)) {
		case "http":
			conditions = append(conditions, "COALESCE(sc.enable_http, true) = true")
		case "https":
			conditions = append(conditions, "COALESCE(sc.enable_https, true) = true")
		case "socks5":
			conditions = append(conditions, "sc.enable_socks5 = true")
		case "ssh":
			conditions = append(conditions, "sc.enable_ssh_tunnel = true")
		}
	}
	if len(conditions) == 0 {
		return query
	}
	return query.Where("(" + strings.Join(conditions, " OR ") + ")")
}

// ApplySort applies browse sort order (listing index API).
func ApplySort(query *gorm.DB, q Query) *gorm.DB {
	sortBy := strings.ToLower(strings.TrimSpace(q.SortBy))
	sortOrder := normalizeSortOrder(q.SortOrder, "desc")

	switch sortBy {
	case "price_asc":
		return query.Order("proxy_listings.price_per_gb ASC, proxy_listings.created_at DESC")
	case "price_desc":
		return query.Order("proxy_listings.price_per_gb DESC, proxy_listings.created_at DESC")
	case "price":
		return query.Order("proxy_listings.price_per_gb " + sortOrder + ", proxy_listings.created_at DESC")
	case "rating", "popular":
		return query.Joins("LEFT JOIN profiles seller_profiles ON seller_profiles.id = proxy_listings.seller_id").
			Order("COALESCE(seller_profiles.avg_rating, 0) " + sortOrder + ", proxy_listings.quality_score " + sortOrder + ", proxy_listings.orders_count DESC")
	case "sales":
		return query.Order("proxy_listings.orders_count " + sortOrder + ", proxy_listings.created_at DESC")
	case "uptime":
		return query.Order("proxy_listings.uptime_percent " + sortOrder + ", proxy_listings.avg_latency_ms ASC, proxy_listings.created_at DESC")
	case "latency":
		return query.Order("proxy_listings.avg_latency_ms ASC, proxy_listings.uptime_percent DESC, proxy_listings.created_at DESC")
	case "quality":
		return query.Order("proxy_listings.quality_score " + sortOrder + ", proxy_listings.created_at DESC")
	case "newest", "":
		if sortOrder == "ASC" {
			return query.Order("proxy_listings.created_at ASC")
		}
		return query.Order("proxy_listings.created_at DESC")
	default:
		return query.Order("proxy_listings.created_at DESC")
	}
}

// ServiceDiscoveryOrder is the default sort for GET /v1/services.
func ServiceDiscoveryOrder(query *gorm.DB) *gorm.DB {
	return query.Order("proxy_listings.quality_score DESC, proxy_listings.price_per_gb ASC")
}

func normalizeSortOrder(order, fallback string) string {
	switch strings.ToLower(strings.TrimSpace(order)) {
	case "asc":
		return "ASC"
	case "desc":
		return "DESC"
	}
	if strings.ToLower(fallback) == "asc" {
		return "ASC"
	}
	return "DESC"
}

// ClampLimit normalizes pagination bounds.
func ClampLimit(page, limit int) (int, int) {
	if page < 0 {
		page = 0
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	return page, limit
}

// Offset returns the SQL offset for listing discovery pagination.
// Page 0 (legacy /v1/services) and page 1 (canonical /v1/listings) both address the first page.
func Offset(page, limit int) int {
	if page <= 1 {
		return 0
	}
	return (page - 1) * limit
}
