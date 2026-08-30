package api

import (
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

// defaultOpenAPISpecURL is where the rendered contract lives: the docs site
// serves the repo-authoritative docs/openapi.yaml (synced at build time).
const defaultOpenAPISpecURL = "https://docs.proxyhubb.com/openapi.yaml"

// RegisterOpenAPISpecRoutes makes the API host resolve the OpenAPI contract
// instead of 404ing. Redirects (not a second copy) so the spec can never
// drift between the API and the docs site. Override with PROXYHUB_OPENAPI_URL.
func RegisterOpenAPISpecRoutes(r *gin.Engine) {
	target := os.Getenv("PROXYHUB_OPENAPI_URL")
	if target == "" {
		target = defaultOpenAPISpecURL
	}
	handler := func(c *gin.Context) {
		c.Redirect(http.StatusFound, target)
	}
	r.GET("/openapi.json", handler)
	r.GET("/openapi.yaml", handler)
}
