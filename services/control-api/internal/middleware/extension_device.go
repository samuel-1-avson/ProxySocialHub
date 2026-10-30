package middleware

import (
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

const AuthTypeExtensionDevice = "extension_device"

// ExtensionOriginAllowed is true for chrome-extension://<32 a-p id> and
// moz-extension://<uuid> (Firefox gives each install its own random UUID origin).
func ExtensionOriginAllowed(origin string) bool {
	origin = strings.TrimSpace(origin)
	if id, ok := strings.CutPrefix(origin, "chrome-extension://"); ok {
		return ValidChromeExtensionID(strings.TrimSuffix(id, "/"))
	}
	if id, ok := strings.CutPrefix(origin, "moz-extension://"); ok {
		_, err := uuid.Parse(strings.TrimSuffix(id, "/"))
		return err == nil
	}
	return false
}

// geckoEmailID is AMO's email-style add-on id, e.g. extension@proxyhubb.com.
var geckoEmailID = regexp.MustCompile(`^[a-zA-Z0-9._-]*@[a-zA-Z0-9._-]+$`)

// ValidExtensionID accepts the runtime.id of a Chrome/Edge extension or of a
// Firefox add-on ("name@domain" or "{uuid}", at most 80 chars per AMO).
func ValidExtensionID(id string) bool {
	if ValidChromeExtensionID(id) {
		return true
	}
	if len(id) == 0 || len(id) > 80 {
		return false
	}
	if strings.HasPrefix(id, "{") && strings.HasSuffix(id, "}") {
		_, err := uuid.Parse(id[1 : len(id)-1])
		return err == nil
	}
	return geckoEmailID.MatchString(id)
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
	if !ValidExtensionID(strings.TrimSpace(extensionID)) {
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
