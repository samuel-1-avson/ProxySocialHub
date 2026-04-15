package providerlease

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
	Audience = "proxyhubb-edge-gateway-provider"
)

type Claims struct {
	UserID            string   `json:"user_id"`
	ConnectionType    string   `json:"connection_type"`
	AvailablePorts    []uint16 `json:"available_ports,omitempty"`
	MaxConnections    uint32   `json:"max_connections"`
	MaxBandwidthMbps  uint32   `json:"max_bandwidth_mbps"`
	UplinkSpeedKbps   uint32   `json:"uplink_speed_kbps"`
	DownlinkSpeedKbps uint32   `json:"downlink_speed_kbps"`
	CPUCores          uint32   `json:"cpu_cores"`
	MemoryMB          uint32   `json:"memory_mb"`
	OS                string   `json:"os,omitempty"`
	ClientVersion     string   `json:"client_version,omitempty"`
	Features          []string `json:"features,omitempty"`
	jwt.RegisteredClaims
}

type Params struct {
	UserID            uuid.UUID
	ConnectionType    string
	AvailablePorts    []uint16
	MaxConnections    uint32
	MaxBandwidthMbps  uint32
	UplinkSpeedKbps   uint32
	DownlinkSpeedKbps uint32
	CPUCores          uint32
	MemoryMB          uint32
	OS                string
	ClientVersion     string
	Features          []string
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
	if raw := strings.TrimSpace(os.Getenv("PROVIDER_LEASE_TTL_SECONDS")); raw != "" {
		if ttlSeconds, err := time.ParseDuration(raw + "s"); err == nil && ttlSeconds > 0 {
			return ttlSeconds
		}
	}
	return 10 * time.Minute
}

func DefaultRenewAfterSeconds() int {
	ttlSeconds := int(ResolveTTL().Seconds())
	renewAfter := ttlSeconds - 60
	if renewAfter < 30 {
		return 30
	}
	return renewAfter
}

func Issue(secret string, params Params) (string, Claims, error) {
	now := time.Now().UTC()
	claims := Claims{
		UserID:            params.UserID.String(),
		ConnectionType:    params.ConnectionType,
		AvailablePorts:    params.AvailablePorts,
		MaxConnections:    params.MaxConnections,
		MaxBandwidthMbps:  params.MaxBandwidthMbps,
		UplinkSpeedKbps:   params.UplinkSpeedKbps,
		DownlinkSpeedKbps: params.DownlinkSpeedKbps,
		CPUCores:          params.CPUCores,
		MemoryMB:          params.MemoryMB,
		OS:                params.OS,
		ClientVersion:     params.ClientVersion,
		Features:          params.Features,
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
		return nil, errors.New("invalid provider lease token")
	}

	return claims, nil
}
