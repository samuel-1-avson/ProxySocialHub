package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// RegisterReputationRoutes registers the ZK-Reputation endpoints
func RegisterReputationRoutes(rg *gin.RouterGroup) {
	rg.GET("/reputation/telemetry", getReputationTelemetry)
	rg.POST("/reputation/verify", verifyReputationProof)
}

// ReputationTelemetryResponse contains the fragments needed for client-side proving
type ReputationTelemetryResponse struct {
	Fragments []ReputationFragment `json:"fragments"`
	TrustRoot string               `json:"trust_root"`
	Timestamp time.Time            `json:"timestamp"`
}

type ReputationFragment struct {
	SessionID string `json:"session_id"`
	NodeID    string `json:"node_id"`
	Nonce     int    `json:"nonce"`
	Status    string `json:"status"`
}

// verifyReputationProof handles the submission of ZK proofs
func verifyReputationProof(c *gin.Context) {
	var req struct {
		Proof interface{} `json:"proof"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid proof format"})
		return
	}

	// Industrial Logic: Verify ZK Proof against Poseidon Root
	// For this phase, we simulate the verification success
	// assuming the proof passed the circuit constraints.

	// Issue a short-lived Reputation Token (JWT or specialized signal)
	token := uuid.New().String()

	c.JSON(http.StatusOK, gin.H{
		"token":      token,
		"status":     "verified",
		"expires_at": time.Now().Add(1 * time.Hour).Format(time.RFC3339),
	})
}

// getReputationTelemetry returns the buyer's historical settlement fingerprints
func getReputationTelemetry(c *gin.Context) {
	// In production, this queries the database for the user's successful L2 settlements
	// We return a list of "Proof Fragments" that the client-side Halo2 prover will use.

	fragments := []ReputationFragment{
		{SessionID: uuid.New().String(), NodeID: "node-primary-01", Nonce: 42, Status: "settled"},
		{SessionID: uuid.New().String(), NodeID: "node-high-perf-09", Nonce: 156, Status: "settled"},
	}

	c.JSON(http.StatusOK, ReputationTelemetryResponse{
		Fragments: fragments,
		TrustRoot: "0x7f4e9a2b5c8d1e0f...", // Poseidon root of the latest registry state
		Timestamp: time.Now(),
	})
}
