package api

import (
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// Expose a bounded, non-sensitive evidence summary. Identity/configuration hashes
// and authentication material are never included in marketplace read models.
func enrichListingsQuality(listings []models.ProxyListing) {
	ids := []uuid.UUID{}
	for _, listing := range listings {
		if listing.QualityAssessmentID != nil {
			ids = append(ids, *listing.QualityAssessmentID)
		}
	}
	if len(ids) == 0 {
		return
	}
	var assessments []struct {
		AcceptedID uuid.UUID
		models.ListingQualitySummary
	}
	err := db.DB.Raw(`SELECT accepted.id AS accepted_id, latest.quality_score, latest.tier, latest.confidence, latest.provisional,
        latest.status, latest.summary, latest.completed_at, latest.price_per_gb AS recommended_price_per_gb
        FROM proxy_assessments accepted JOIN LATERAL (
          SELECT candidate.* FROM proxy_assessments candidate WHERE candidate.provider_node_id = accepted.provider_node_id
          AND candidate.configuration_hash = accepted.configuration_hash AND candidate.completed_at IS NOT NULL
          ORDER BY candidate.created_at DESC LIMIT 1
        ) latest ON true WHERE accepted.id IN ?`, ids).Scan(&assessments).Error
	if err != nil {
		return
	}
	byID := map[uuid.UUID]models.ListingQualitySummary{}
	for _, a := range assessments {
		byID[a.AcceptedID] = a.ListingQualitySummary
	}
	for i := range listings {
		if listings[i].QualityAssessmentID != nil {
			if summary, ok := byID[*listings[i].QualityAssessmentID]; ok {
				listings[i].QualityAssessment = &summary
			}
		}
	}
}
