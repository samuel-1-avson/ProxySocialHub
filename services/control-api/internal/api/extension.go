package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/middleware"
	"github.com/proxyhubb/control-api/internal/models"
)

const (
	extensionPairTTL       = 60 * time.Second
	extensionPairAlphabet  = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	extensionPairCodeLen   = 8
	extensionDeviceNameMax = 100
)

type extensionPairFinishRequest struct {
	Code        string `json:"code"`
	ExtensionID string `json:"extension_id"`
	Name        string `json:"name"`
}

type extensionRefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func RegisterExtensionPublicRoutes(rg *gin.RouterGroup) {
	rg.POST("/extension/pair/finish", RateLimitWithConfig(20, time.Minute), finishExtensionPair)
	rg.POST("/extension/refresh", RateLimitWithConfig(20, time.Minute), refreshExtensionDevice)
}

func RegisterExtensionProtectedRoutes(rg *gin.RouterGroup) {
	rg.POST("/extension/pair/start", RateLimitWithConfig(10, time.Minute), startExtensionPair)
	rg.GET("/extension/bootstrap", getExtensionBootstrap)
	rg.POST("/extension/revoke", revokeExtensionDevice)
}

func startExtensionPair(c *gin.Context) {
	if c.GetString("auth_type") == middleware.AuthTypeExtensionDevice {
		c.JSON(http.StatusForbidden, gin.H{"error": "pair from the website session, not the extension token"})
		return
	}
	userID, err := currentUserUUID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database unavailable"})
		return
	}

	raw, err := randomPairCode()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not mint pairing code"})
		return
	}
	row := models.ExtensionPairCode{
		ID:        uuid.New(),
		CodeHash:  hashPairCode(raw),
		UserID:    userID,
		ExpiresAt: time.Now().UTC().Add(extensionPairTTL),
		CreatedAt: time.Now().UTC(),
	}
	if err := db.DB.Create(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not store pairing code"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"code":       raw,
		"expires_in": int(extensionPairTTL.Seconds()),
	})
}

func finishExtensionPair(c *gin.Context) {
	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database unavailable"})
		return
	}
	var req extensionPairFinishRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON"})
		return
	}
	code := strings.TrimSpace(req.Code)
	extID := strings.ToLower(strings.TrimSpace(req.ExtensionID))
	if code == "" || !middleware.ValidChromeExtensionID(extID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code and a valid extension_id are required"})
		return
	}

	now := time.Now().UTC()
	var pair models.ExtensionPairCode
	if err := db.DB.Where("code_hash = ?", hashPairCode(code)).First(&pair).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired pairing code"})
		return
	}
	if pair.ConsumedAt != nil || !pair.ExpiresAt.After(now) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired pairing code"})
		return
	}

	consumed := now
	res := db.DB.Model(&models.ExtensionPairCode{}).
		Where("id = ? AND consumed_at IS NULL AND expires_at > ?", pair.ID, now).
		Update("consumed_at", consumed)
	if res.Error != nil || res.RowsAffected != 1 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired pairing code"})
		return
	}

	var user models.User
	if err := db.DB.First(&user, "id = ?", pair.UserID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "user not found"})
		return
	}

	name := strings.TrimSpace(req.Name)
	if len(name) > extensionDeviceNameMax {
		name = name[:extensionDeviceNameMax]
	}
	if name == "" {
		name = "Chrome"
	}

	var device models.ExtensionDevice
	err := db.DB.Where("user_id = ? AND extension_id = ?", user.ID, extID).First(&device).Error
	if err != nil {
		device = models.ExtensionDevice{
			ID:          uuid.New(),
			UserID:      user.ID,
			ExtensionID: extID,
			Name:        name,
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		if err := db.DB.Create(&device).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not persist device"})
			return
		}
	} else {
		device.Name = name
		device.RevokedAt = nil
		device.UpdatedAt = now
		if err := db.DB.Save(&device).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update device"})
			return
		}
	}

	session, sessErr := issueExtensionDeviceSession(&user, &device)
	if sessErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": sessErr.Error()})
		return
	}
	c.JSON(http.StatusOK, session)
}

func refreshExtensionDevice(c *gin.Context) {
	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database unavailable"})
		return
	}
	var req extensionRefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON"})
		return
	}
	raw := strings.TrimSpace(req.RefreshToken)
	if raw == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh_token required"})
		return
	}
	var device models.ExtensionDevice
	if err := db.DB.Where("refresh_token_hash = ? AND revoked_at IS NULL", hashPairCode(raw)).
		First(&device).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
		return
	}
	now := time.Now().UTC()
	if device.RefreshExpiresAt == nil || !device.RefreshExpiresAt.After(now) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh token expired"})
		return
	}
	var user models.User
	if err := db.DB.First(&user, "id = ?", device.UserID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}
	session, err := issueExtensionDeviceSession(&user, &device)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, session)
}

func getExtensionBootstrap(c *gin.Context) {
	userID, err := currentUserUUID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database unavailable"})
		return
	}

	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}

	var devices []models.ExtensionDevice
	_ = db.DB.Where("user_id = ? AND revoked_at IS NULL", userID).
		Order("created_at DESC").
		Find(&devices).Error

	var orders []models.Order
	_ = db.DB.Preload("Listing").
		Where("buyer_id = ? AND status IN ?", userID, []models.OrderStatus{
			models.OrderStatusActive,
			models.OrderStatusCompleted,
		}).
		Order("created_at DESC").
		Limit(20).
		Find(&orders).Error

	summaries := make([]gin.H, 0, len(orders))
	for _, o := range orders {
		title := ""
		if o.Listing != nil {
			title = o.Listing.Title
		}
		summaries = append(summaries, gin.H{
			"id":                o.ID,
			"status":            o.Status,
			"listing_title":     title,
			"credentials_ready": orderCredentialsEligible(o.Status),
		})
	}

	label := user.Email
	if user.DisplayName != nil && strings.TrimSpace(*user.DisplayName) != "" {
		label = strings.TrimSpace(*user.DisplayName)
	}

	c.JSON(http.StatusOK, gin.H{
		"user": gin.H{
			"id":    user.ID,
			"email": user.Email,
			"label": label,
			"role":  user.Role,
		},
		"devices": devices,
		"orders":  summaries,
		"proxy": gin.H{
			"endpoint":          func() string { _, _, e := BuyerProxyConnectInfo(); return e }(),
			"auth_for_endpoint": publishedBuyerAuthHMAC,
			"protocol":          "http",
		},
		"connect_ready": true,
		"note":          "PR-D: unpacked build can set Chrome HTTP CONNECT to HMAC proxy.proxyhubb.com:8090. Turn off does not unpair.",
	})
}

func revokeExtensionDevice(c *gin.Context) {
	if c.GetString("auth_type") != middleware.AuthTypeExtensionDevice {
		c.JSON(http.StatusBadRequest, gin.H{"error": "revoke the paired device token"})
		return
	}
	deviceID := strings.TrimSpace(c.GetString("extension_device_id"))
	id, err := uuid.Parse(deviceID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid device"})
		return
	}
	now := time.Now().UTC()
	if err := db.DB.Model(&models.ExtensionDevice{}).
		Where("id = ? AND revoked_at IS NULL", id).
		Updates(map[string]interface{}{
			"revoked_at":         now,
			"refresh_token_hash": "",
			"updated_at":         now,
		}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not revoke"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"revoked": true})
}

func issueExtensionDeviceSession(user *models.User, device *models.ExtensionDevice) (gin.H, error) {
	secret, err := requireJWTSecret()
	if err != nil {
		return nil, err
	}
	accessTTL := authAccessTokenTTL()
	token, err := crypto.GenerateDeviceToken(user.ID, user.Role, user.Email, device.ID.String(), device.ExtensionID, secret, accessTTL)
	if err != nil {
		return nil, err
	}
	rawRefresh, err := randomHex(32)
	if err != nil {
		return nil, err
	}
	refreshTTL := authRefreshTokenTTL()
	exp := time.Now().UTC().Add(refreshTTL)
	now := time.Now().UTC()
	if err := db.DB.Model(device).Updates(map[string]interface{}{
		"refresh_token_hash": hashPairCode(rawRefresh),
		"refresh_expires_at": exp,
		"last_seen_at":       now,
		"updated_at":         now,
	}).Error; err != nil {
		return nil, err
	}
	label := user.Email
	if user.DisplayName != nil && strings.TrimSpace(*user.DisplayName) != "" {
		label = strings.TrimSpace(*user.DisplayName)
	}
	return gin.H{
		"token":                    token,
		"refresh_token":            rawRefresh,
		"access_token_expires_at":  time.Now().UTC().Add(accessTTL),
		"refresh_token_expires_at": exp,
		"device_id":                device.ID,
		"user": gin.H{
			"id":    user.ID,
			"email": user.Email,
			"label": label,
			"role":  user.Role,
		},
	}, nil
}

func currentUserUUID(c *gin.Context) (uuid.UUID, error) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				return id, nil
			}
			if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	return uuid.Parse(userIDStr)
}

func randomPairCode() (string, error) {
	buf := make([]byte, extensionPairCodeLen)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	out := make([]byte, extensionPairCodeLen)
	n := byte(len(extensionPairAlphabet))
	for i := 0; i < extensionPairCodeLen; i++ {
		out[i] = extensionPairAlphabet[buf[i]%n]
	}
	return string(out), nil
}

func hashPairCode(raw string) string {
	norm := strings.ToUpper(strings.TrimSpace(raw))
	sum := sha256.Sum256([]byte(norm))
	return hex.EncodeToString(sum[:])
}
