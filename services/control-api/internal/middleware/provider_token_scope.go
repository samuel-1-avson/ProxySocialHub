package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/crypto"
)

// AuthTypeProviderToken is set for requests authenticated by a provider CLI token
// (pt_...) or by the JWT minted from one.
const AuthTypeProviderToken = "provider_token"

// markProviderNodeClaims tags a request whose JWT was minted from a provider CLI token
// so RestrictProviderToken applies to it just as it does to a raw pt_ token.
func markProviderNodeClaims(c *gin.Context, claims *crypto.CustomClaims) {
	if claims != nil && claims.IsProviderNode() {
		c.Set("auth_type", AuthTypeProviderToken)
	}
}

// RestrictProviderToken confines provider CLI tokens, and JWTs minted from them, to the
// routes a headless node needs. These tokens live in config files on provider machines;
// before this they were accepted on every /v1 route as the owner's full session, so a
// leaked node token could withdraw the owner's wallet, mint API keys or buy bandwidth.
func RestrictProviderToken() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetString("auth_type") != AuthTypeProviderToken {
			c.Next()
			return
		}
		if providerTokenPathAllowed(c.Request.Method, c.Request.URL.Path) {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"error": "provider token cannot call this route",
			"code":  "provider_token_scope",
		})
	}
}

// providerTokenPathAllowed lists what provider-node, provider-cli and the provider SDK
// wrappers call: node registration and heartbeats, leases, gateway token exchange,
// an earnings summary, and CLI downloads.
func providerTokenPathAllowed(method, path string) bool {
	path = strings.TrimSuffix(path, "/")
	switch {
	case path == "/v1/provider/nodes" || strings.HasPrefix(path, "/v1/provider/nodes/"):
		return true
	case path == "/v1/provider/lease" || strings.HasPrefix(path, "/v1/provider/lease/"):
		return true
	case path == "/v1/provider/gateway-token":
		return true
	case path == "/v1/provider/earnings/summary" && method == http.MethodGet:
		return true
	case strings.HasPrefix(path, "/v1/cli/") && method == http.MethodGet:
		return true
	}
	return false
}
