package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/custody"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"google.golang.org/api/idtoken"
	"gorm.io/gorm"
)

type googleLoginRequest struct {
	Credential   string `json:"credential" binding:"required"` // Google Identity Services ID token
	ReferralCode string `json:"referral_code,omitempty"`
}

// googleIdentity is what we use from a verified Google ID token.
type googleIdentity struct {
	Subject       string
	Email         string
	EmailVerified bool
	IssuedAt      int64
}

// verifyGoogleToken checks signature, audience, issuer and expiry. A var so tests can stub it.
var verifyGoogleToken = func(ctx context.Context, credential, clientID string) (googleIdentity, error) {
	payload, err := idtoken.Validate(ctx, credential, clientID)
	if err != nil {
		return googleIdentity{}, err
	}
	if payload.Issuer != "accounts.google.com" && payload.Issuer != "https://accounts.google.com" {
		return googleIdentity{}, fmt.Errorf("unexpected issuer %q", payload.Issuer)
	}
	email, _ := payload.Claims["email"].(string)
	verified, _ := payload.Claims["email_verified"].(bool)
	return googleIdentity{Subject: payload.Subject, Email: email, EmailVerified: verified, IssuedAt: payload.IssuedAt}, nil
}

// googleLogin signs a user in with a Google ID token. First sign-in creates the account
// and a server-held (embedded) Solana wallet for it.
// POST /v1/auth/google
func googleLogin(c *gin.Context) {
	cfg, err := config.Load()
	if err != nil {
		log.Printf("[AUTH] google: config load: %v", err)
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Internal configuration error"})
		return
	}
	clientID := strings.TrimSpace(cfg.OAuth.GoogleClientID)
	if clientID == "" {
		c.JSON(http.StatusServiceUnavailable, ErrorResponse{Error: "Google sign-in is not configured"})
		return
	}

	var req googleLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "credential is required"})
		return
	}

	identity, err := verifyGoogleToken(c.Request.Context(), req.Credential, clientID)
	if err != nil || identity.Subject == "" {
		RecordAuditLog(c, models.AuditAuthLoginFailed, models.AuditSeverityWarning, nil, "google", "", "Invalid Google ID token", false)
		c.JSON(http.StatusUnauthorized, ErrorResponse{Error: "Google sign-in failed. Please try again."})
		return
	}
	if !identity.EmailVerified || strings.TrimSpace(identity.Email) == "" {
		c.JSON(http.StatusUnauthorized, ErrorResponse{Error: "Your Google email is not verified"})
		return
	}

	user, created, err := findOrCreateGoogleUserContext(c.Request.Context(), identity, req.ReferralCode)
	if err != nil {
		log.Printf("[AUTH] google: account for sub=%s…: %v", maskAddress(identity.Subject), err)
		if errors.Is(err, custody.ErrKEKNotConfigured) || errors.Is(err, custody.ErrLocalKEKInStrictEnv) || errors.Is(err, custody.ErrKEKUnavailable) {
			c.JSON(http.StatusServiceUnavailable, ErrorResponse{Error: "Sign-up is temporarily unavailable"})
			return
		}
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to sign in"})
		return
	}
	if created {
		log.Printf("[AUTH] Created new Google user %s", user.ID)
	}

	completeLoginOrChallenge(c, user, cfg.Auth.JWTSecret)
}

// findOrCreateGoogleUser resolves the account by Google `sub` (never by email).
func findOrCreateGoogleUser(identity googleIdentity, referralCode string) (models.User, bool, error) {
	return findOrCreateGoogleUserContext(context.Background(), identity, referralCode)
}

func findOrCreateGoogleUserContext(ctx context.Context, identity googleIdentity, referralCode string) (models.User, bool, error) {
	var link models.UserIdentity
	err := db.DB.Where("provider = ? AND subject = ?", models.IdentityProviderGoogle, identity.Subject).First(&link).Error
	if err == nil {
		var user models.User
		if err := db.DB.Where("id = ?", link.UserID).First(&user).Error; err != nil {
			return models.User{}, false, fmt.Errorf("load linked profile: %w", err)
		}
		now := time.Now()
		db.DB.Model(&link).Update("last_login_at", now)

		return user, false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return models.User{}, false, err
	}

	kek, err := custody.DefaultKEK()
	if err != nil {
		return models.User{}, false, err
	}

	email := models.NormalizeEmail(identity.Email)
	var user models.User
	err = db.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		created, err := createAccount(tx, email, "user_"+uuid.NewString()[:8], nil)
		if err != nil {
			return err
		}
		user = created

		wallet, err := custody.FindWallet(tx, user.ID)
		if errors.Is(err, custody.ErrNoEmbeddedWallet) {
			wallet, err = custody.CreateSolanaWallet(tx, kek, user.ID)
		}
		if err != nil {
			return fmt.Errorf("embedded wallet: %w", err)
		}

		// A map update runs the User BeforeSave hook with user.Email (the real address from
		// the insert): it fills email_hash, encrypts the email into profile_private and sets
		// profiles.email to NULL. (Save(&user) would write "" instead of NULL.)
		user.Email = email
		if err := tx.Model(&user).Updates(map[string]interface{}{
			"wallet_address": wallet.Address,
			"email_verified": true,
		}).Error; err != nil {
			return fmt.Errorf("profile update: %w", err)
		}
		user.WalletAddress = &wallet.Address
		user.EmailVerified = true

		now := time.Now()
		return tx.Create(&models.UserIdentity{
			ID:          uuid.New(),
			UserID:      user.ID,
			Provider:    models.IdentityProviderGoogle,
			Subject:     identity.Subject,
			EmailHash:   models.HashEmail(email),
			LastLoginAt: &now,
		}).Error
	})
	if err != nil {
		return models.User{}, false, err
	}

	// Marketplace/escrow code expects a primary linked Solana wallet.
	if err := ensurePrimaryLinkedSolana(db.DB, user.ID, *user.WalletAddress, nil, nil); err != nil {
		log.Printf("[AUTH] google: ensurePrimaryLinkedSolana for %s: %v", user.ID, err)
	}
	if code := strings.TrimSpace(referralCode); code != "" {
		ProcessReferralSignup(user.ID, code)
	}
	return user, true, nil
}
