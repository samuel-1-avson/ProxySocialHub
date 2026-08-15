package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/gateways"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// RegisterGatewayOperatorPublicRoutes exposes Wave 5.B discovery (no auth).
func RegisterGatewayOperatorPublicRoutes(r *gin.RouterGroup) {
	r.GET("/gateways/operators", listGatewayOperators)
	r.GET("/gateways/operators/bundle", exportGatewayOperatorBundle)
	r.GET("/gateways/operators/:id", getGatewayOperator)
}

func listGatewayOperators(c *gin.Context) {
	_ = gateways.SeedFromEnv()
	enforce := gateways.BondEnforceEnabled()
	rows, err := gateways.ListActive(enforce)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list gateway operators"})
		return
	}
	filtered := make([]models.GatewayOperator, 0, len(rows))
	for i := range rows {
		if !gateways.ManifestPassesEnforce(&rows[i]) {
			continue
		}
		filtered = append(filtered, rows[i])
	}
	views := make([]gateways.OperatorView, 0, len(filtered))
	for i := range filtered {
		healthy, pod := gateways.ProbeHealth(c.Request.Context(), &filtered[i])
		if gateways.ManifestEnforce() {
			ok, _ := gateways.VerifyManifest(&filtered[i])
			if !ok {
				healthy = false
			}
		}
		views = append(views, gateways.ToView(&filtered[i], healthy, pod))
	}
	c.JSON(http.StatusOK, gin.H{
		"operators":    views,
		"bond_enforce": enforce,
		"honesty":      gateways.HonestyMeta(filtered),
	})
}

func exportGatewayOperatorBundle(c *gin.Context) {
	_ = gateways.SeedFromEnv()
	enforce := gateways.BondEnforceEnabled()
	rows, err := gateways.ListActive(enforce)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list gateway operators"})
		return
	}
	filtered := make([]models.GatewayOperator, 0, len(rows))
	for i := range rows {
		if !gateways.ManifestPassesEnforce(&rows[i]) {
			continue
		}
		filtered = append(filtered, rows[i])
	}
	bundle := gateways.BuildBundle(filtered)
	c.JSON(http.StatusOK, bundle)
}

func getGatewayOperator(c *gin.Context) {
	_ = gateways.SeedFromEnv()
	row, err := gateways.GetByIDOrSlug(c.Param("id"))
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "operator not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load operator"})
		return
	}
	if gateways.BondEnforceEnabled() && !row.Bonded {
		c.JSON(http.StatusNotFound, gin.H{"error": "operator not found"})
		return
	}
	if row.Status != gateways.StatusActive {
		c.JSON(http.StatusNotFound, gin.H{"error": "operator not found"})
		return
	}
	if !gateways.ManifestPassesEnforce(row) {
		c.JSON(http.StatusNotFound, gin.H{"error": "operator not found"})
		return
	}
	healthy, pod := gateways.ProbeHealth(c.Request.Context(), row)
	c.JSON(http.StatusOK, gateways.ToView(row, healthy, pod))
}

// recordGatewaySlashAudit persists an observe-only slashing_events row (no on-chain tx).
// POST /v1/gateway/slash-audit (gateway auth).
func recordGatewaySlashAudit(c *gin.Context) {
	var req struct {
		GatewayAddress string `json:"gateway_address"`
		ProviderID     string `json:"provider_id"`
		SessionID      string `json:"session_id"`
		Reason         string `json:"reason" binding:"required"`
		TokenType      string `json:"token_type"`
		Evidence       string `json:"evidence"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	addr := req.GatewayAddress
	if addr == "" {
		addr = req.ProviderID
	}
	if addr == "" {
		addr = "unknown"
	}
	reason := req.Reason
	if req.TokenType != "" {
		reason = reason + " token_type=" + req.TokenType
	}
	if req.SessionID != "" {
		reason = reason + " session_id=" + req.SessionID
	}
	if req.ProviderID != "" && req.GatewayAddress != "" {
		reason = reason + " provider_id=" + req.ProviderID
	}
	evidence := req.Evidence
	if len(evidence) > 100 {
		evidence = evidence[:100]
	}
	ev := models.SlashingEvent{
		GatewayAddress:  addr,
		SlashPercentage: 0, // observe-only; no economic slash
		Reason:          reason,
		Evidence:        evidence,
		TxHash:          "", // deliberately empty — not on-chain
		ExecutedAt:      time.Now().UTC(),
	}
	if err := db.DB.Create(&ev).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record slash audit"})
		return
	}
	msg := "honeytoken slash audit recorded; no on-chain slash (Wave 8: bonded program undeployed; dual-gate no-op)"
	if solanaSlashArmed() {
		msg = "slash gates armed but bonded-gateway program is undeployed; audit only (not programs/session)"
	}
	c.JSON(http.StatusCreated, gin.H{
		"id":                     ev.ID,
		"observe":                true,
		"on_chain":               false,
		"would_broadcast":        false,
		"programs_session":       "unsafe_do_not_deploy",
		"bonded_gateway_program": gateways.BondedGatewayProgramHonesty(),
		"gateway_slash_execute":  gateways.SlashExecuteMode(),
		"live_economic_slash":    false,
		"message":                msg,
	})
}

func solanaSlashArmed() bool {
	return gateways.SlashExecuteMode() == "gates_armed_undeployed"
}
