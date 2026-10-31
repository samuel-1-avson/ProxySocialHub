package middleware

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// The WAF must not block legitimate automation whose User-Agent advertises a
// shell name (WindowsPowerShell, curl). Shell-keyword patterns still apply to
// the path, query, and other headers.
func TestWAFAllowsShellUserAgents(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := DefaultWAFConfig()

	for _, ua := range []string{
		"Mozilla/5.0 (Windows NT; Windows NT 10.0; en-US) WindowsPowerShell/5.1",
		"curl/8.22.0",
		"ProxyHubb-CLI-Installer",
	} {
		req := httptest.NewRequest("GET", "/v1/cli/install.ps1", nil)
		req.Header.Set("User-Agent", ua)
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = req

		if got := detectAttack(c, cfg); got != "" {
			t.Errorf("User-Agent %q blocked as %s", ua, got)
		}
	}
}

// The same keywords in the query string must still be blocked.
func TestWAFStillBlocksShellKeywordsInQuery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := DefaultWAFConfig()

	req := httptest.NewRequest("GET", "/v1/cli/download?platform=windows&cmd=powershell", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0")
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	if got := detectAttack(c, cfg); got == "" {
		t.Error("expected powershell in query to be blocked")
	}
}
