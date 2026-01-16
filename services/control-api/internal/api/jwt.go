package api

import (
	"errors"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("token has expired")
	ErrMissingToken = errors.New("missing token")
)

// Claims represents the JWT claims
type Claims struct {
	UserID string `json:"user_id"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

// RefreshClaims represents refresh token claims
type RefreshClaims struct {
	UserID string `json:"user_id"`
	jwt.RegisteredClaims
}

// TokenPair represents access and refresh tokens
type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

// getJWTSecret returns the JWT secret from environment or a default
func getJWTSecret() []byte {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		// Default secret for development - MUST be changed in production
		secret = "proxyhubb-dev-secret-change-in-production"
	}
	return []byte(secret)
}

// getRefreshSecret returns the refresh token secret
func getRefreshSecret() []byte {
	secret := os.Getenv("JWT_REFRESH_SECRET")
	if secret == "" {
		secret = "proxyhubb-refresh-secret-change-in-production"
	}
	return []byte(secret)
}

// GenerateTokenPair creates both access and refresh tokens
func GenerateTokenPair(userID, role string) (*TokenPair, error) {
	accessToken, expiresIn, err := GenerateAccessToken(userID, role)
	if err != nil {
		return nil, err
	}

	refreshToken, err := GenerateRefreshToken(userID)
	if err != nil {
		return nil, err
	}

	return &TokenPair{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    expiresIn,
		TokenType:    "Bearer",
	}, nil
}

// GenerateAccessToken creates a new access token (24 hours)
func GenerateAccessToken(userID, role string) (string, int64, error) {
	expiresIn := int64(24 * 60 * 60) // 24 hours in seconds
	expirationTime := time.Now().Add(24 * time.Hour)

	claims := &Claims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    "proxyhubb",
			ID:        uuid.New().String(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(getJWTSecret())
	if err != nil {
		return "", 0, err
	}

	return tokenString, expiresIn, nil
}

// GenerateRefreshToken creates a new refresh token (7 days)
func GenerateRefreshToken(userID string) (string, error) {
	expirationTime := time.Now().Add(7 * 24 * time.Hour)

	claims := &RefreshClaims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    "proxyhubb",
			ID:        uuid.New().String(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(getRefreshSecret())
}

// ValidateAccessToken validates an access token and returns the claims
func ValidateAccessToken(tokenString string) (*Claims, error) {
	claims := &Claims{}

	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return getJWTSecret(), nil
	})

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}

	if !token.Valid {
		return nil, ErrInvalidToken
	}

	return claims, nil
}

// ValidateRefreshToken validates a refresh token and returns the claims
func ValidateRefreshToken(tokenString string) (*RefreshClaims, error) {
	claims := &RefreshClaims{}

	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return getRefreshSecret(), nil
	})

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}

	if !token.Valid {
		return nil, ErrInvalidToken
	}

	return claims, nil
}

// TempClaims represents temporary token claims (for 2FA flow)
type TempClaims struct {
	UserID string `json:"user_id"`
	jwt.RegisteredClaims
}

// getTempSecret returns the temp token secret
func getTempSecret() []byte {
	secret := os.Getenv("JWT_TEMP_SECRET")
	if secret == "" {
		secret = "proxyhubb-temp-secret-change-in-production"
	}
	return []byte(secret)
}

// GenerateTempToken creates a short-lived token for 2FA verification (5 minutes)
func GenerateTempToken(userID string) (string, error) {
	expirationTime := time.Now().Add(5 * time.Minute)

	claims := &TempClaims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    "proxyhubb-2fa",
			ID:        uuid.New().String(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(getTempSecret())
}

// ValidateTempToken validates a temporary token and returns the claims
func ValidateTempToken(tokenString string) (*TempClaims, error) {
	claims := &TempClaims{}

	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return getTempSecret(), nil
	})

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}

	if !token.Valid {
		return nil, ErrInvalidToken
	}

	return claims, nil
}
