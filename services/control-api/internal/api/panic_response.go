package api

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/logging"
)

func recoverHandlerPanic(c *gin.Context, handler string, userID string, r interface{}) {
	logging.Error(fmt.Errorf("panic: %v", r)).
		Str("handler", handler).
		Str("user_id", userID).
		Msg("Recovered from panic")
	if !c.Writer.Written() {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Internal Server Error",
			"code":  "INTERNAL_ERROR",
		})
	}
}
