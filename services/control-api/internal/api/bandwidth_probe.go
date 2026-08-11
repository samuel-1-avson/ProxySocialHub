package api

import (
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	bandwidthProbeMaxBytes = 4 * 1024 * 1024 // 4 MiB hard cap per probe
)

// RegisterBandwidthProbeRoute registers the upload throughput probe used by provider apply.
func RegisterBandwidthProbeRoute(rg *gin.RouterGroup) {
	rg.POST("/provider/bandwidth-probe", probeProviderUploadBandwidth)
}

// probeProviderUploadBandwidth discards an authenticated upload body so the client
// can measure wall-clock throughput. Returns bytes received for client verification.
func probeProviderUploadBandwidth(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	started := time.Now()
	limited := http.MaxBytesReader(c.Writer, c.Request.Body, bandwidthProbeMaxBytes)
	defer limited.Close()

	n, err := io.Copy(io.Discard, limited)
	if err != nil {
		// MaxBytesReader returns *http.MaxBytesError when the cap is exceeded.
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{
			"error": "Probe payload too large (max 4 MiB)",
		})
		return
	}

	elapsedMs := time.Since(started).Milliseconds()
	if elapsedMs < 1 {
		elapsedMs = 1
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":            true,
		"user_id":       userID.String(),
		"bytes_received": n,
		"server_ms":     elapsedMs,
	})
}
