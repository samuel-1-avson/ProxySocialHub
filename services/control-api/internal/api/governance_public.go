package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/solana"
)

// RegisterGovernancePublicRoutes exposes read-only governance readiness (no auth).
func RegisterGovernancePublicRoutes(r *gin.RouterGroup) {
	r.GET("/governance/execution-readiness", getGovernanceExecutionReadiness)
}

func getGovernanceExecutionReadiness(c *gin.Context) {
	report := solana.GetGovernanceExecutionCapabilityReport(c.Request.Context())
	c.JSON(http.StatusOK, gin.H{"governance_execution": report})
}
