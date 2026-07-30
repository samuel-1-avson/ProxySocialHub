package funnel

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/marketplace/collections"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// OrderedSteps is the canonical marketplace conversion funnel (view → credentials).
var OrderedSteps = []string{
	models.FunnelListingView,
	models.FunnelListingSave,
	models.FunnelBuyModalOpen,
	models.FunnelOrderCreated,
	models.FunnelEscrowInitiated,
	models.FunnelEscrowConfirmed,
	models.FunnelCredentialsDelivered,
}

// SummaryParams filters funnel aggregation.
type SummaryParams struct {
	From       time.Time
	To         time.Time
	Collection string
	Country    string
	SellerID   *uuid.UUID
}

// StepCount is one funnel step aggregate.
type StepCount struct {
	EventName string `json:"event_name"`
	Count     int64  `json:"count"`
}

// Summary is the dashboard payload for marketplace funnel analytics.
type Summary struct {
	From       string             `json:"from"`
	To         string             `json:"to"`
	Filters    SummaryFilters     `json:"filters"`
	Steps      []StepCount        `json:"steps"`
	Conversion map[string]float64 `json:"conversion"`
	Countries  []string           `json:"countries"`
}

// SummaryFilters echoes applied query filters.
type SummaryFilters struct {
	Collection string `json:"collection,omitempty"`
	Country    string `json:"country,omitempty"`
	SellerID   string `json:"seller_id,omitempty"`
}

type eventCountRow struct {
	EventName string `gorm:"column:event_name"`
	Count     int64  `gorm:"column:count"`
}

// Summarize aggregates marketplace_funnel_events with optional listing filters.
func Summarize(ctx context.Context, params SummaryParams) (*Summary, error) {
	if params.From.IsZero() || params.To.IsZero() {
		return nil, fmt.Errorf("from and to are required")
	}
	if params.To.Before(params.From) {
		return nil, fmt.Errorf("to must be on or after from")
	}

	collection := strings.ToLower(strings.TrimSpace(params.Collection))
	country := strings.TrimSpace(params.Country)

	query := db.DB.WithContext(ctx).Table("marketplace_funnel_events AS e").
		Select("e.event_name, COUNT(*) AS count").
		Where("e.created_at >= ? AND e.created_at <= ?", params.From, params.To)

	needsListingJoin := collection != "" || country != "" || params.SellerID != nil
	if needsListingJoin {
		query = query.Joins("INNER JOIN proxy_listings ON proxy_listings.id = e.listing_id")
	}

	var err error
	query, err = collections.ApplyListingCollectionFilter(query, collection)
	if err != nil {
		return nil, err
	}
	if country != "" {
		query = query.Where("LOWER(proxy_listings.country) = LOWER(?)", country)
	}
	if params.SellerID != nil {
		query = query.Where("proxy_listings.seller_id = ?", *params.SellerID)
	}

	var rows []eventCountRow
	if err := query.Group("e.event_name").Scan(&rows).Error; err != nil {
		return nil, err
	}

	counts := make(map[string]int64, len(rows))
	for _, row := range rows {
		counts[row.EventName] = row.Count
	}

	steps := make([]StepCount, 0, len(OrderedSteps))
	for _, name := range OrderedSteps {
		steps = append(steps, StepCount{EventName: name, Count: counts[name]})
	}

	countries, err := distinctCountries(ctx, params)
	if err != nil {
		return nil, err
	}

	out := &Summary{
		From: params.From.UTC().Format(time.RFC3339),
		To:   params.To.UTC().Format(time.RFC3339),
		Filters: SummaryFilters{
			Collection: collection,
			Country:    country,
		},
		Steps:      steps,
		Conversion: computeConversion(counts),
		Countries:  countries,
	}
	if params.SellerID != nil {
		out.Filters.SellerID = params.SellerID.String()
	}
	return out, nil
}

func distinctCountries(ctx context.Context, params SummaryParams) ([]string, error) {
	q := db.DB.WithContext(ctx).Table("marketplace_funnel_events AS e").
		Select("DISTINCT proxy_listings.country").
		Joins("INNER JOIN proxy_listings ON proxy_listings.id = e.listing_id").
		Where("e.created_at >= ? AND e.created_at <= ?", params.From, params.To).
		Where("proxy_listings.country IS NOT NULL AND proxy_listings.country <> ''")

	if params.SellerID != nil {
		q = q.Where("proxy_listings.seller_id = ?", *params.SellerID)
	}
	var err error
	q, err = collections.ApplyListingCollectionFilter(q, strings.ToLower(strings.TrimSpace(params.Collection)))
	if err != nil {
		return nil, err
	}

	var countries []string
	if err := q.Order("proxy_listings.country ASC").Pluck("proxy_listings.country", &countries).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return []string{}, nil
		}
		return nil, err
	}
	return countries, nil
}

func computeConversion(counts map[string]int64) map[string]float64 {
	view := float64(counts[models.FunnelListingView])
	order := float64(counts[models.FunnelOrderCreated])
	escrow := float64(counts[models.FunnelEscrowConfirmed])

	out := map[string]float64{
		"view_to_order":             ratio(order, view),
		"order_to_escrow_confirmed": ratio(escrow, order),
		"view_to_escrow_confirmed":  ratio(escrow, view),
	}
	return out
}

func ratio(num, den float64) float64 {
	if den <= 0 {
		return 0
	}
	return num / den
}
