package api

import (
	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/custody"
	"os"
)

func authCapabilities(c *gin.Context) {
	err := custody.Ready(c.Request.Context())
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"google_sign_in": os.Getenv("GOOGLE_CLIENT_ID") != "", "managed_wallet_signup": err == nil, "managed_wallet_custody": "Operator-held wallets. Remote key management protects stored keys; the operator decrypts signing keys in memory to authorize transactions.", "privacy_defaults": "private", "buyer_transport": "tls", "settlement": "Public Solana wallets and transactions remain linkable."})
}
