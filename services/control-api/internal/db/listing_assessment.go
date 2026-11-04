package db

import (
	"errors"
	"time"

	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/quality"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// validateListingAssessment runs inside the listing write transaction. Locking the
// node prevents configuration changes between validation and publication.
func validateListingAssessment(tx *gorm.DB, listing *models.ProxyListing) error {
	if listing.QualityAssessmentID == nil {
		if !quality.Enforced() {
			return nil
		}
		return errors.New("quality assessment required: assess the node and accept its price before publication")
	}
	if listing.ProviderNodeID == nil {
		return errors.New("a quality-assessed offer requires a provider node")
	}
	var node models.ProviderNode
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", *listing.ProviderNodeID, listing.SellerID).First(&node).Error; err != nil {
		return errors.New("provider node not found")
	}
	var assessment models.ProxyAssessment
	if err := tx.First(&assessment, "id = ? AND seller_id = ?", *listing.QualityAssessmentID, listing.SellerID).Error; err != nil {
		return errors.New("quality assessment not found")
	}
	config := quality.Configuration{ProxyType: string(listing.ProxyType), Protocol: listing.Protocol, RotationType: listing.RotationType, Country: listing.Country, MaxConcurrency: listing.MaxConcurrency}
	if err := quality.ValidateOffer(assessment, node, config, listing.PricePerGB, time.Now()); err != nil {
		return err
	}
	listing.QualityScore, listing.CurrentTier = assessment.QualityScore, assessment.Tier
	listing.AvgLatencyMs = int(assessment.LatencyP50Ms)
	listing.SuccessRate = float64(assessment.SuccessfulSamples) / float64(assessment.Samples) * 100
	// An initial transfer test has no historical uptime measurement.
	listing.UptimePercent = 0
	return nil
}

// ValidateAcceptedListingQuality protects moderation activation too. A price
// accepted while its quote was valid survives a moderation delay; configuration
// and ownership must still match. Historical purchases need no new assessment.
func ValidateAcceptedListingQuality(tx *gorm.DB, listing models.ProxyListing) error {
	if listing.QualityAssessmentID == nil {
		if quality.Enforced() {
			return errors.New("quality assessment required before activation")
		}
		return nil
	}
	if listing.ProviderNodeID == nil {
		return errors.New("provider node required")
	}
	var node models.ProviderNode
	if err := tx.Where("id = ? AND user_id = ?", *listing.ProviderNodeID, listing.SellerID).First(&node).Error; err != nil {
		return errors.New("provider node not found")
	}
	var a models.ProxyAssessment
	if err := tx.First(&a, "id = ?", *listing.QualityAssessmentID).Error; err != nil {
		return errors.New("quality assessment not found")
	}
	return quality.ValidateOffer(a, node, quality.Configuration{ProxyType: string(listing.ProxyType), Protocol: listing.Protocol, RotationType: listing.RotationType, Country: listing.Country, MaxConcurrency: listing.MaxConcurrency}, listing.PricePerGB, listing.CreatedAt)
}
