package matching

import (
	"github.com/proxyhubb/control-api/internal/models"
)

// UseCaseType defines the supported use cases for smart matching
type UseCaseType string

const (
	UseCaseGeneral   UseCaseType = "general"
	UseCaseStreaming UseCaseType = "streaming"
	UseCaseScraping  UseCaseType = "scraping"
	UseCaseGaming    UseCaseType = "gaming"
	UseCasePrivacy   UseCaseType = "privacy"
)

// UseCaseProfile defines the weightings for a specific use case
type UseCaseProfile struct {
	Name             string
	Description      string
	WeightLatency    float64 // Penalize high latency
	WeightUptime     float64 // Reward high uptime
	WeightBandwidth  float64 // Reward high bandwidth
	WeightTrustScore float64 // Reward high trust score
	WeightPrice      float64 // Penalize high price (future)
}

// ScoredNode represents a proxy listing with its calculated match score
type ScoredNode struct {
	Listing models.ProxyListing `json:"listing"`
	Score   float64             `json:"score"` // 0.0 to 100.0
	Reason  []string            `json:"reasons"`
}

// RecommendationRequest is the input for the matching engine
type RecommendationRequest struct {
	UseCase  UseCaseType `json:"use_case" binding:"required"`
	Region   string      `json:"region"`    // Optional limit by region
	MaxPrice float64     `json:"max_price"` // Optional price limit
	Count    int         `json:"count"`     // Number of recommendations (default 5)
}
