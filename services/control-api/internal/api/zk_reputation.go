package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// RegisterReputationRoutes registers the ZK-Reputation endpoints
// DEPRECATED: ZK reputation proofs are not currently implemented.
// These endpoints return 501 Not Implemented to prevent false security assumptions.
func RegisterReputationRoutes(rg *gin.RouterGroup) {
	rg.GET("/reputation/telemetry", getReputationTelemetry)
	rg.POST("/reputation/verify", verifyReputationProof)
}

// verifyReputationProof handles the submission of ZK proofs
// DEPRECATED: Returns 501 Not Implemented
// The previous implementation was a stub that always returned "verified",
// which created a false sense of security. Real ZK verification requires:
// - Halo2 proof verification circuit
// - Poseidon hash root validation
// - Proper cryptographic verification (not implemented)
func verifyReputationProof(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{
		"error":   "not_implemented",
		"message": "ZK reputation verification is not implemented. This feature is planned for a future release with proper Halo2/Poseidon proof verification.",
		"status":  "disabled",
	})
}

// getReputationTelemetry returns the buyer's historical settlement fingerprints
// DEPRECATED: Returns 501 Not Implemented
// The previous implementation returned mock data that could be misleading.
func getReputationTelemetry(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{
		"error":   "not_implemented",
		"message": "Reputation telemetry is not implemented. This feature is planned for a future release.",
		"status":  "disabled",
	})
}
