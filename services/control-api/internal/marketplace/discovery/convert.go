package discovery

import (
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
)

// FromServiceFilter maps legacy GET /v1/services query parameters.
func FromServiceFilter(filter models.ServiceFilter) Query {
	page, limit := ClampLimit(filter.Page, filter.Limit)

	q := Query{
		Page:                      page,
		Limit:                     limit,
		Protocols:                 filter.Protocols,
		TargetCountries:           filter.TargetCountries,
		MinBandwidthMbps:          filter.MinBandwidthMbps,
		PriorityTier:              string(filter.PriorityTier),
		RequireCaptchaSolving:     filter.RequireCaptchaSolving,
		RequireJsRendering:        filter.RequireJsRendering,
		RequireBrowserFingerprint: filter.RequireBrowserFingerprint,
		RequireStickySession:      filter.RequireStickySession,
		RequireAutoRotation:       filter.RequireAutoRotation,
	}

	if filter.MinQualityScore > 0 {
		q.MinQualityScore = filter.MinQualityScore
		q.MinQualitySet = true
	}
	if filter.MinSuccessRate > 0 {
		q.MinSuccessRate = filter.MinSuccessRate
		q.MinSuccessSet = true
	}
	if filter.MinUptimePercent > 0 {
		q.MinUptimePercent = filter.MinUptimePercent
		q.MinUptimeSet = true
	}
	if filter.MaxPricePerGB > 0 {
		q.MaxPrice = filter.MaxPricePerGB
		q.MaxPriceSet = true
	}

	return q
}

// FromListingFilterMap maps GET /v1/listings query parameters (handler-built map).
func FromListingFilterMap(filters map[string]interface{}) Query {
	q := Query{
		Page:         intFilter(filters, "page", 1),
		Limit:        intFilter(filters, "limit", 20),
		ProxyType:    stringFilter(filters, "proxy_type"),
		Protocol:     stringFilter(filters, "protocol"),
		RotationType: stringFilter(filters, "rotation_type"),
		Country:      stringFilter(filters, "country"),
		ISP:          stringFilter(filters, "isp"),
		SellerID:     uuidFilter(filters, "seller_id"),
		SortBy:       stringFilter(filters, "sort_by"),
		SortOrder:    stringFilter(filters, "sort_order"),
	}

	if v, ok := floatFilter(filters, "min_price"); ok {
		q.MinPrice = v
		q.MinPriceSet = true
	}
	if v, ok := floatFilter(filters, "max_price"); ok {
		q.MaxPrice = v
		q.MaxPriceSet = true
	}
	if v, ok := floatFilter(filters, "min_rating"); ok {
		q.MinRating = v
		q.MinRatingSet = true
	}
	if v, ok := floatFilter(filters, "min_quality_score"); ok {
		q.MinQualityScore = v
		q.MinQualitySet = true
	}
	if v, ok := floatFilter(filters, "min_success_rate"); ok {
		q.MinSuccessRate = v
		q.MinSuccessSet = true
	}
	if v, ok := floatFilter(filters, "min_uptime_percent"); ok {
		q.MinUptimePercent = v
		q.MinUptimeSet = true
	}
	if v, ok := intFilterOK(filters, "min_bandwidth_mbps"); ok {
		q.MinBandwidthMbps = v
	}

	q.Protocols = stringSliceFilter(filters, "protocols")
	if len(q.Protocols) == 0 {
		if single := stringFilter(filters, "protocols"); single != "" {
			q.Protocols = splitCSV(single)
		}
	}

	if q.Page < 1 {
		q.Page = 1
	}
	_, q.Limit = ClampLimit(0, q.Limit)
	return q
}

func stringFilter(filters map[string]interface{}, key string) string {
	value, ok := filters[key]
	if !ok || value == nil {
		return ""
	}
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case uuid.UUID:
		if v == uuid.Nil {
			return ""
		}
		return v.String()
	default:
		return ""
	}
}

func uuidFilter(filters map[string]interface{}, key string) uuid.UUID {
	value := stringFilter(filters, key)
	if value == "" {
		return uuid.Nil
	}
	parsed, err := uuid.Parse(value)
	if err != nil {
		return uuid.Nil
	}
	return parsed
}

func floatFilter(filters map[string]interface{}, key string) (float64, bool) {
	value, ok := filters[key]
	if !ok || value == nil {
		return 0, false
	}
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func intFilter(filters map[string]interface{}, key string, fallback int) int {
	value, ok := intFilterOK(filters, key)
	if !ok {
		return fallback
	}
	return value
}

func intFilterOK(filters map[string]interface{}, key string) (int, bool) {
	value, ok := filters[key]
	if !ok || value == nil {
		return 0, false
	}
	switch v := value.(type) {
	case int:
		return v, true
	case int64:
		return int(v), true
	case float64:
		return int(v), true
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(v))
		if err == nil {
			return parsed, true
		}
	}
	return 0, false
}

func stringSliceFilter(filters map[string]interface{}, key string) []string {
	value, ok := filters[key]
	if !ok || value == nil {
		return nil
	}
	switch v := value.(type) {
	case []string:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if trimmed := strings.TrimSpace(item); trimmed != "" {
				out = append(out, trimmed)
			}
		}
		return out
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				if trimmed := strings.TrimSpace(s); trimmed != "" {
					out = append(out, trimmed)
				}
			}
		}
		return out
	default:
		return nil
	}
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
