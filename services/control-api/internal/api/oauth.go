package api

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/markbates/goth"
	"github.com/markbates/goth/gothic"
	"github.com/markbates/goth/providers/github"
	"github.com/markbates/goth/providers/google"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

func InitOAuth() {
	googleClientID := os.Getenv("GOOGLE_CLIENT_ID")
	googleClientSecret := os.Getenv("GOOGLE_CLIENT_SECRET")
	githubClientID := os.Getenv("GITHUB_CLIENT_ID")
	githubClientSecret := os.Getenv("GITHUB_CLIENT_SECRET")
	callbackURL := os.Getenv("API_BASE_URL") + "/v1/auth"

	if callbackURL == "/v1/auth" {
		callbackURL = "http://localhost:8080/v1/auth"
	}

	providers := []goth.Provider{}

	if googleClientID != "" && googleClientSecret != "" {
		log.Printf("Initializing Google OAuth (ClientID len: %d)", len(googleClientID))
		providers = append(providers, google.New(googleClientID, googleClientSecret, callbackURL+"/google/callback"))
	} else {
		log.Printf("Google OAuth credentials missing (ClientID: '%s', Secret len: %d)", googleClientID, len(googleClientSecret))
	}

	if githubClientID != "" && githubClientSecret != "" {
		log.Printf("Initializing GitHub OAuth (ClientID len: %d)", len(githubClientID))
		providers = append(providers, github.New(githubClientID, githubClientSecret, callbackURL+"/github/callback"))
	} else {
		log.Printf("GitHub OAuth credentials missing (ClientID: '%s', Secret len: %d)", githubClientID, len(githubClientSecret))
	}

	goth.UseProviders(providers...)
}

func RegisterOAuthRoutes(r *gin.RouterGroup) {
	InitOAuth()

	auth := r.Group("/auth")
	{
		auth.GET("/:provider", beginOAuth)
		auth.GET("/:provider/callback", completeOAuth)
	}
}

func beginOAuth(c *gin.Context) {
	provider := c.Param("provider")
	q := c.Request.URL.Query()
	q.Add("provider", provider)
	c.Request.URL.RawQuery = q.Encode()

	gothic.BeginAuthHandler(c.Writer, c.Request)
}

func completeOAuth(c *gin.Context) {
	provider := c.Param("provider")
	q := c.Request.URL.Query()
	q.Add("provider", provider)
	c.Request.URL.RawQuery = q.Encode()

	user, err := gothic.CompleteUserAuth(c.Writer, c.Request)
	if err != nil {
		c.Redirect(http.StatusTemporaryRedirect, fmt.Sprintf("%s/auth/callback?error=%s", os.Getenv("FRONTEND_URL"), err.Error()))
		return
	}

	// Handle user login/creation
	authUser, err := handleOAuthUser(user, provider)
	if err != nil {
		c.Redirect(http.StatusTemporaryRedirect, fmt.Sprintf("%s/auth/callback?error=%s", os.Getenv("FRONTEND_URL"), "Failed to process user"))
		return
	}

	// Generate tokens
	tokenPair, err := GenerateTokenPair(authUser.ID.String(), authUser.Role)
	if err != nil {
		c.Redirect(http.StatusTemporaryRedirect, fmt.Sprintf("%s/auth/callback?error=%s", os.Getenv("FRONTEND_URL"), "Failed to generate tokens"))
		return
	}

	// Redirect to frontend with tokens
	frontendURL := os.Getenv("FRONTEND_URL")
	if frontendURL == "" {
		frontendURL = "http://localhost:3000"
	}

	redirectURL := fmt.Sprintf("%s/auth/callback?access_token=%s&refresh_token=%s&expires_in=%d",
		frontendURL, tokenPair.AccessToken, tokenPair.RefreshToken, tokenPair.ExpiresIn)

	c.Redirect(http.StatusTemporaryRedirect, redirectURL)
}

func handleOAuthUser(gothUser goth.User, provider string) (*models.User, error) {
	var user models.User
	var oauthIdentity models.OAuthIdentity

	// Check if identity exists
	result := db.DB.Where("provider = ? AND provider_user_id = ?", provider, gothUser.UserID).First(&oauthIdentity)

	if result.Error == nil {
		// Identity exists, find user
		if err := db.DB.First(&user, "id = ?", oauthIdentity.UserID).Error; err != nil {
			return nil, err
		}
		return &user, nil
	}

	// Check if user exists by email
	result = db.DB.Where("email = ?", gothUser.Email).First(&user)
	if result.Error == nil {
		// User exists, link identity
		oauthIdentity = models.OAuthIdentity{
			UserID:         user.ID,
			Provider:       provider,
			ProviderUserID: gothUser.UserID,
			Email:          gothUser.Email,
			AccessToken:    gothUser.AccessToken,
			RefreshToken:   gothUser.RefreshToken,
			ExpiresAt:      gothUser.ExpiresAt,
		}
		if err := db.DB.Create(&oauthIdentity).Error; err != nil {
			return nil, err
		}
		return &user, nil
	}

	// Create new user
	user = models.User{
		Email:         gothUser.Email,
		Role:          "buyer", // Default role
		EmailVerified: true,    // OAuth emails are verified
	}

	tx := db.DB.Begin()
	if err := tx.Create(&user).Error; err != nil {
		tx.Rollback()
		return nil, err
	}

	oauthIdentity = models.OAuthIdentity{
		UserID:         user.ID,
		Provider:       provider,
		ProviderUserID: gothUser.UserID,
		Email:          gothUser.Email,
		AccessToken:    gothUser.AccessToken,
		RefreshToken:   gothUser.RefreshToken,
		ExpiresAt:      gothUser.ExpiresAt,
	}

	if err := tx.Create(&oauthIdentity).Error; err != nil {
		tx.Rollback()
		return nil, err
	}

	tx.Commit()
	return &user, nil
}
