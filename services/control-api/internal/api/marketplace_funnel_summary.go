package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/marketplace/funnel"
	"github.com/proxyhubb/control-api/internal/middleware"
)

// RegisterMarketplaceFunnelAnalyticsRoutes registers seller-scoped funnel summary.
func RegisterMarketplaceFunnelAnalyticsRoutes(rg *gin.RouterGroup) {
	rg.GET("/analytics/marketplace/funnel", middleware.RequireProviderRole(), getSellerMarketplaceFunnel)
}

func getAdminMarketplaceFunnel(c *gin.Context) {
	params, ok := parseFunnelSummaryParams(c)
	if !ok {
		return
	}
	summary, err := funnel.Summarize(c.Request.Context(), params)
	if err != nil {
		if strings.Contains(err.Error(), "unknown collection") ||
			strings.Contains(err.Error(), "from and to") ||
			strings.Contains(err.Error(), "to must be") {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load funnel summary"})
		return
	}
	c.JSON(http.StatusOK, summary)
}

func getSellerMarketplaceFunnel(c *gin.Context) {
	params, ok := parseFunnelSummaryParams(c)
	if !ok {
		return
	}
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	sellerID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}
	params.SellerID = &sellerID

	summary, err := funnel.Summarize(c.Request.Context(), params)
	if err != nil {
		if strings.Contains(err.Error(), "unknown collection") ||
			strings.Contains(err.Error(), "from and to") ||
			strings.Contains(err.Error(), "to must be") {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load funnel summary"})
		return
	}
	c.JSON(http.StatusOK, summary)
}

func parseFunnelSummaryParams(c *gin.Context) (funnel.SummaryParams, bool) {
	now := time.Now().UTC()
	fromStr := c.DefaultQuery("from", now.AddDate(0, 0, -30).Format("2006-01-02"))
	toStr := c.DefaultQuery("to", now.Format("2006-01-02"))

	from, err := time.ParseInLocation("2006-01-02", fromStr, time.UTC)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid 'from' date, expected YYYY-MM-DD"})
		return funnel.SummaryParams{}, false
	}
	to, err := time.ParseInLocation("2006-01-02", toStr, time.UTC)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid 'to' date, expected YYYY-MM-DD"})
		return funnel.SummaryParams{}, false
	}
	// Inclusive end of day.
	to = to.Add(24*time.Hour - time.Nanosecond)

	return funnel.SummaryParams{
		From:       from,
		To:         to,
		Collection: c.Query("collection"),
		Country:    c.Query("country"),
	}, true
}
