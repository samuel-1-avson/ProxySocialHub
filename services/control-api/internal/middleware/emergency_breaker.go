package middleware

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/redis"
)

const EmergencyPauseKey = "system:emergency_pause_active"

// EmergencyBreaker prevents state-changing operations if the system is paused
func EmergencyBreaker() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Only check for mutation methods
		method := c.Request.Method
		if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete {

			// Check Redis for pause flag
			val, err := redis.Client.Get(context.Background(), EmergencyPauseKey).Result()
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
