package middleware

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

const AuthTypeExtensionDevice = "extension_device"

// ChromeExtensionOriginAllowed is true for chrome-extension://<32 a-p id>.
func ChromeExtensionOriginAllowed(origin string) bool {
	const prefix = "chrome-extension://"
	origin = strings.TrimSpace(origin)
	if !strings.HasPrefix(origin, prefix) {
		return false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(origin, prefix), "/")
	return ValidChromeExtensionID(id)
}

// ValidChromeExtensionID is a Chrome/Edge unpacked or CWS id (32 chars, a-p).
func ValidChromeExtensionID(id string) bool {
	if len(id) != 32 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if c < 'a' || c > 'p' {
			return false
		}
	}
	return true
}

func bindExtensionDeviceClaims(c *gin.Context, claims *crypto.CustomClaims) bool {
	if claims == nil || !claims.IsExtensionDevice() {
		return true
	}
	if !ExtensionDeviceActive(claims.DeviceID, claims.ExtID) {
		return false
	}
	c.Set("auth_type", AuthTypeExtensionDevice)
	c.Set("extension_device_id", claims.DeviceID)
	c.Set("extension_id", claims.ExtID)
	return true
}

// ExtensionDeviceActive is true when the device row exists and is not revoked.
func ExtensionDeviceActive(deviceID, extensionID string) bool {
	if db.DB == nil {
		return false
	}
	id, err := uuid.Parse(strings.TrimSpace(deviceID))
	if err != nil {
		return false
	}
	if !ValidChromeExtensionID(strings.TrimSpace(extensionID)) {
		return false
	}
	var row models.ExtensionDevice
	if err := db.DB.Where("id = ? AND extension_id = ? AND revoked_at IS NULL", id, strings.TrimSpace(extensionID)).
		First(&row).Error; err != nil {
		return false
	}
	now := time.Now().UTC()
	_ = db.DB.Model(&row).Update("last_seen_at", now).Error
	return true
}

// RestrictExtensionDevice blocks device JWTs from spending SOL or mutating
// account state. GET orders / usage / extension bootstrap+revoke only.
func RestrictExtensionDevice() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetString("auth_type") != AuthTypeExtensionDevice {
			c.Next()
			return
		}
		if extensionDevicePathAllowed(c.Request.Method, c.Request.URL.Path) {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"error": "extension token cannot call this route",
		})
	}
}

func extensionDevicePathAllowed(method, path string) bool {
	path = strings.TrimSuffix(path, "/")
	if path == "/v1/extension/bootstrap" && method == http.MethodGet {
		return true
	}
	if path == "/v1/extension/revoke" && method == http.MethodPost {
		return true
	}
	if strings.HasPrefix(path, "/v1/orders") && method == http.MethodGet {
		return true
	}
	if strings.HasPrefix(path, "/v1/usage") && method == http.MethodGet {
		return true
	}
	return false
}
