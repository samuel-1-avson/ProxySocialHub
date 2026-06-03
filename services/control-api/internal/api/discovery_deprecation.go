package api

import "github.com/gin-gonic/gin"

// deprecatedDiscoveryHeaders marks legacy GET/POST /v1/services* routes superseded by /v1/listings.
func deprecatedDiscoveryHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Deprecation", "true")
		c.Header("Link", `</v1/listings>; rel="successor-version"`)
		c.Header("Sunset", "Mon, 01 Sep 2026 23:59:59 GMT")
		c.Next()
	}
}
