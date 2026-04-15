package sessionintent

import (
	"errors"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const (
	Issuer   = "proxyhubb-control-api"
	Audience = "proxyhubb-edge-gateway"
)

type Claims struct {
	UserID                  string   `json:"user_id"`
	ListingID               string   `json:"listing_id,omitempty"`
	SessionType             string   `json:"session_type"`
	TrustTier               string   `json:"trust_tier"`
	BandwidthLimit          int64    `json:"bandwidth_limit"`
	TargetGeo               string   `json:"target_geo,omitempty"`
	TargetISP               string   `json:"target_isp,omitempty"`
	RoutingProfile          string   `json:"routing_profile,omitempty"`
	AllowedDomains          []string `json:"allowed_domains,omitempty"`
	BlockedDomains          []string `json:"blocked_domains,omitempty"`
	RotationType            string   `json:"rotation_type,omitempty"`
	RotationIntervalSeconds int      `json:"rotation_interval_seconds,omitempty"`
	TimeLimitMinutes        int      `json:"time_limit_minutes,omitempty"`
	PreferredTier           string   `json:"preferred_tier,omitempty"`
	RequestsPerMinute       int      `json:"requests_per_minute"`
	MaxConcurrency          int      `json:"max_concurrency"`
	MaxPricePerGB           float64  `json:"max_price_per_gb,omitempty"`
	jwt.RegisteredClaims
}

type Params struct {
	UserID                  uuid.UUID
	ListingID               string
	SessionType             string
	TrustTier               string
	BandwidthLimit          int64
	TargetGeo               string
	TargetISP               string
	RoutingProfile          string
	AllowedDomains          []string
	BlockedDomains          []string
	RotationType            string
	RotationIntervalSeconds int
	TimeLimitMinutes        int
	PreferredTier           string
	RequestsPerMinute       int
	MaxConcurrency          int
	MaxPricePerGB           float64
}

func ResolveSigningSecret() (string, error) {
	if secret := strings.TrimSpace(os.Getenv("GATEWAY_SHARED_SECRET")); secret != "" {
		return secret, nil
	}
	if secret := strings.TrimSpace(os.Getenv("JWT_SECRET")); secret != "" {
		return secret, nil
	}
	return "", errors.New("neither GATEWAY_SHARED_SECRET nor JWT_SECRET is configured")
}

func ResolveTTL() time.Duration {
	if raw := strings.TrimSpace(os.Getenv("SESSION_INTENT_TTL_SECONDS")); raw != "" {
		if ttlSeconds, err := time.ParseDuration(raw + "s"); err == nil && ttlSeconds > 0 {
			return ttlSeconds
		}
	}
	return 2 * time.Minute
}

func Issue(secret string, params Params) (string, Claims, error) {
	now := time.Now().UTC()
	claims := Claims{
		UserID:                  params.UserID.String(),
		ListingID:               params.ListingID,
		SessionType:             params.SessionType,
		TrustTier:               params.TrustTier,
		BandwidthLimit:          params.BandwidthLimit,
		TargetGeo:               params.TargetGeo,
		TargetISP:               params.TargetISP,
		RoutingProfile:          params.RoutingProfile,
		AllowedDomains:          params.AllowedDomains,
		BlockedDomains:          params.BlockedDomains,
		RotationType:            params.RotationType,
		RotationIntervalSeconds: params.RotationIntervalSeconds,
		TimeLimitMinutes:        params.TimeLimitMinutes,
		PreferredTier:           params.PreferredTier,
		RequestsPerMinute:       params.RequestsPerMinute,
		MaxConcurrency:          params.MaxConcurrency,
		MaxPricePerGB:           params.MaxPricePerGB,
		RegisteredClaims: jwt.RegisteredClaims{
			Audience:  jwt.ClaimStrings{Audience},
			ExpiresAt: jwt.NewNumericDate(now.Add(ResolveTTL())),
			ID:        uuid.NewString(),
			IssuedAt:  jwt.NewNumericDate(now),
			Issuer:    Issuer,
			NotBefore: jwt.NewNumericDate(now),
			Subject:   params.UserID.String(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", Claims{}, err
	}

	return signed, claims, nil
}

func ParseAndValidate(tokenString string, secret string) (*Claims, error) {
	validation := jwt.NewParser(
		jwt.WithAudience(Audience),
		jwt.WithIssuer(Issuer),
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
	)

	token, err := validation.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid session intent token")
	}

	return claims, nil
}
