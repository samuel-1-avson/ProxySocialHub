package middleware

import (
	"crypto/subtle"
	"net"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

const metricsTokenEnv = "PROXYHUB_METRICS_TOKEN"

func metricsToken() string {
	return strings.TrimSpace(os.Getenv(metricsTokenEnv))
}

func providedMetricsToken(c *gin.Context) string {
	if h := strings.TrimSpace(c.GetHeader("X-Metrics-Token")); h != "" {
		return h
	}
	auth := strings.TrimSpace(c.GetHeader("Authorization"))
	if len(auth) >= 7 && strings.EqualFold(auth[:7], "bearer ") {
		return strings.TrimSpace(auth[7:])
	}
	return ""
}

func hostnameOnly(host string) string {
	host = strings.TrimSpace(host)
	if h, _, err := net.SplitHostPort(host); err == nil {
		return strings.ToLower(h)
	}
	return strings.ToLower(host)
}

func isPublicMetricsHost(host string) bool {
	h := hostnameOnly(host)
	return h == "proxyhubb.com" || strings.HasSuffix(h, ".proxyhubb.com")
}

func tokenMatches(provided, expected string) bool {
	if expected == "" {
		return false
	}
	if subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1 {
		return true
	}
	return false
}

// MetricsRequestAuthorized is true for Prometheus scrapes on the compose
// network (Host control-api:8080, no forwarded headers) or when
// PROXYHUB_METRICS_TOKEN matches. Public Hosts and Caddy-forwarded requests
// are denied unless they present the token.
func MetricsRequestAuthorized(c *gin.Context) bool {
	expected := metricsToken()
	provided := providedMetricsToken(c)
	if expected != "" {
		return tokenMatches(provided, expected)
	}
	if isPublicMetricsHost(c.Request.Host) {
		return false
	}
	if strings.TrimSpace(c.GetHeader("X-Forwarded-For")) != "" || strings.TrimSpace(c.GetHeader("X-Real-IP")) != "" {
		return false
	}
	return true
}

// RequireMetricsAccess hides operational /metrics from the public internet.
// Unauthorized requests get 404 so the endpoint is not advertised.
func RequireMetricsAccess() gin.HandlerFunc {
	return func(c *gin.Context) {
		if MetricsRequestAuthorized(c) {
			c.Next()
			return
		}
		c.AbortWithStatus(http.StatusNotFound)
	}
}
