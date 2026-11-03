package crypto

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const TokenKindExtension = "ext"
const TokenKindMFA = "mfa"

// TokenKindProviderNode marks a JWT minted from a provider CLI token (pt_...). It
// carries the same user id as a normal session, so middleware must scope it to the
// routes a headless node needs (see middleware.RestrictProviderToken).
const TokenKindProviderNode = "pnode"

type CustomClaims struct {
	UserID    string `json:"sub"`
	Role      string `json:"role"`
	Email     string `json:"email,omitempty"`
	Wallet    string `json:"wallet,omitempty"`
	Kind      string `json:"knd,omitempty"`
	DeviceID  string `json:"did,omitempty"`
	ExtID     string `json:"xid,omitempty"`
	SessionID string `json:"sid,omitempty"`
	jwt.RegisteredClaims
}

func GenerateSessionToken(userID uuid.UUID, role, familyID, secret string, duration time.Duration) (string, error) {
	claims := CustomClaims{UserID: userID.String(), Role: role, SessionID: familyID,
		RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(duration)), IssuedAt: jwt.NewNumericDate(time.Now()), Issuer: "proxyhubb-control-api"}}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}

func GenerateMFAChallenge(userID uuid.UUID, challengeID uuid.UUID, secret string) (string, error) {
	claims := CustomClaims{UserID: userID.String(), Kind: TokenKindMFA, RegisteredClaims: jwt.RegisteredClaims{ID: challengeID.String(), ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)), Issuer: "proxyhubb-control-api"}}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}

func (c *CustomClaims) IsExtensionDevice() bool {
	return c != nil && c.Kind == TokenKindExtension
}

// IsProviderNode is true for JWTs minted from a provider CLI token.
func (c *CustomClaims) IsProviderNode() bool {
	return c != nil && c.Kind == TokenKindProviderNode
}

// GenerateProviderNodeToken issues the JWT a headless provider node uses after it
// exchanges its CLI token. It is a normal user JWT plus the provider-node kind claim.
func GenerateProviderNodeToken(userID uuid.UUID, secret string, duration time.Duration) (string, error) {
	claims := CustomClaims{
		UserID: userID.String(),
		Role:   "provider",
		Kind:   TokenKindProviderNode,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(duration)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "proxyhubb-control-api",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// GenerateToken creates a new JWT token for a user
func GenerateToken(userID uuid.UUID, role string, email string, wallet string, secret string, duration time.Duration) (string, error) {
	claims := CustomClaims{
		UserID: userID.String(),
		Role:   role,
		Email:  email,
		Wallet: wallet,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(duration)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "proxyhubb-control-api",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// GenerateTokenWithID is GenerateToken with a JWT id ("jti"), so the session can be revoked
// individually. Admin tokens use it.
func GenerateTokenWithID(userID uuid.UUID, role string, email string, wallet string, secret string, duration time.Duration, jti string) (string, error) {
	claims := CustomClaims{
		UserID: userID.String(),
		Role:   role,
		Email:  email,
		Wallet: wallet,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(duration)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "proxyhubb-control-api",
			ID:        jti,
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// GenerateDeviceToken issues a narrow browser-extension access JWT (kind=ext).
func GenerateDeviceToken(userID uuid.UUID, role, email, deviceID, extensionID, secret string, duration time.Duration) (string, error) {
	claims := CustomClaims{
		UserID:   userID.String(),
		Role:     role,
		Email:    email,
		Kind:     TokenKindExtension,
		DeviceID: deviceID,
		ExtID:    extensionID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(duration)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "proxyhubb-control-api",
			ID:        deviceID,
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ValidateToken verifies the JWT token
func ValidateToken(tokenString string, secret string) (*CustomClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &CustomClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(secret), nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*CustomClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token")
}
