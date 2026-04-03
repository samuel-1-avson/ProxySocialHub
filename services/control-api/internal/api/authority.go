package api

import "github.com/gin-gonic/gin"

const (
	authorityModeChainAuthoritative = "chain_authoritative"
	authorityModeDBAuthoritative    = "db_authoritative"
	authorityModeHybridAsyncChain   = "hybrid_async_chain"
)

// setAuthorityHeaders annotates responses with the runtime authority model
// for the current handler so operators and clients can reason about trust
// assumptions without reading server internals.
func setAuthorityHeaders(c *gin.Context, mode, chainScope, dbRole string) {
	c.Header("X-ProxyHubb-Authority-Mode", mode)
	c.Header("X-ProxyHubb-Authority-Chain-Scope", chainScope)
	c.Header("X-ProxyHubb-Authority-DB-Role", dbRole)
}
