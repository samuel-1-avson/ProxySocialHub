package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/config"
)

// EmergencyPauseKey is the key used in SystemConfiguration and Redis
const EmergencyPauseKey = "system.emergency_pause"

// EmergencyBreaker prevents state-changing operations if the system is paused
func EmergencyBreaker(cm *config.ConfigManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Only check for mutation methods
		method := c.Request.Method
		if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete {

			// Check ConfigManager (Redis with DB fallback)
			val, err := cm.Get(EmergencyPauseKey)
			if err == nil && val == "true" {
				// System is paused!
				c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
					"error": "System is currently in EMERGENCY PAUSE mode. Mutation operations are restricted for security reasons.",
					"code":  "SYSTEM_PAUSED",
				})
				return
			}
		}

		c.Next()
	}
}
