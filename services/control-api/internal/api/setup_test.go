package api

import (
	"github.com/gin-gonic/gin"
)

// setupTestRouter creates a gin router for testing
func setupTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(gin.Recovery())
	return r
}
