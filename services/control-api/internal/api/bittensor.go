package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/bittensor"
	"github.com/proxyhubb/control-api/internal/logging"
)

// RegisterBittensorRoutes registers routes for Bittensor integration
func RegisterBittensorRoutes(r *gin.RouterGroup) {
	bt := r.Group("/bittensor")
	{
		bt.GET("/status", GetNetworkStatus)
		bt.POST("/register", RegisterProxyOnChain)
		bt.POST("/wallet/create", CreateWallet)
		bt.GET("/wallet", GetWallet)
	}
}

// GetNetworkStatus godoc
// @Summary      Get Bittensor Network Status
// @Description  Returns the status of the connected Bittensor node via the bridge
// @Tags         bittensor
// @Produce      json
// @Success      200  {object}  bittensor.NetworkStatus
// @Failure      500  {object}  ErrorResponse
// @Router       /bittensor/status [get]
func GetNetworkStatus(c *gin.Context) {
	client := GetBittensorClient()
	if client == nil {
		c.JSON(http.StatusServiceUnavailable, ErrorResponse{Error: "Bittensor client not initialized"})
		return
	}

	status, err := client.GetNetworkStatus()
	if err != nil {
		logging.Error(err).Msg("Failed to get bittensor network status")
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to get network status"})
		return
	}

	c.JSON(http.StatusOK, status)
}

// RegisterProxyOnChain godoc
// @Summary      Register Proxy on Bittensor
// @Description  Registers a proxy on the Bittensor subnet
// @Tags         bittensor
// @Accept       json
// @Produce      json
// @Param        request body bittensor.RegisterProxyRequest true "Registration Request"
// @Success      200  {object}  bittensor.RegisterProxyResponse
// @Failure      400  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Router       /bittensor/register [post]
func RegisterProxyOnChain(c *gin.Context) {
	var req bittensor.RegisterProxyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	client := GetBittensorClient()
	if client == nil {
		c.JSON(http.StatusServiceUnavailable, ErrorResponse{Error: "Bittensor client not initialized"})
		return
	}

	resp, err := client.RegisterProxy(req)
	if err != nil {
		logging.Error(err).Msg("Failed to register proxy on chain")
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to register proxy"})
		return
	}

	c.JSON(http.StatusOK, resp)
}

// CreateWallet godoc
// @Summary      Create Dev Wallet
// @Description  Creates a new Bittensor wallet for development
// @Tags         bittensor
// @Accept       json
// @Produce      json
// @Param        request body bittensor.WalletInfo true "Wallet Info"
// @Success      200  {object}  bittensor.WalletResponse
// @Failure      500  {object}  ErrorResponse
// @Router       /bittensor/wallet/create [post]
func CreateWallet(c *gin.Context) {
	var req bittensor.WalletInfo
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	client := GetBittensorClient()
	if client == nil {
		c.JSON(http.StatusServiceUnavailable, ErrorResponse{Error: "Bittensor client not initialized"})
		return
	}

	resp, err := client.CreateDevWallet(req.Name, req.Hotkey)
	if err != nil {
		logging.Error(err).Msg("Failed to create wallet")
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to create wallet"})
		return
	}

	c.JSON(http.StatusOK, resp)
}

// GetWallet godoc
// @Summary      Get Wallet Info
// @Description  Gets information about a Bittensor wallet
// @Tags         bittensor
// @Produce      json
// @Param        name   query     string  false  "Wallet Name"
// @Param        hotkey query     string  false  "Hotkey Name"
// @Success      200  {object}  bittensor.WalletResponse
// @Failure      404  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Router       /bittensor/wallet [get]
func GetWallet(c *gin.Context) {
	name := c.DefaultQuery("name", "default")
	hotkey := c.DefaultQuery("hotkey", "default")

	client := GetBittensorClient()
	if client == nil {
		c.JSON(http.StatusServiceUnavailable, ErrorResponse{Error: "Bittensor client not initialized"})
		return
	}

	resp, err := client.GetWallet(name, hotkey)
	if err != nil {
		// Differentiate 404?
		logging.Error(err).Msg("Failed to get wallet")
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to get wallet"})
		return
	}

	c.JSON(http.StatusOK, resp)
}
