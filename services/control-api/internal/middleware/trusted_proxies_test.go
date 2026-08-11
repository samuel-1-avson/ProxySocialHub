package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestResolveTrustedProxiesDefaults(t *testing.T) {
	got := ResolveTrustedProxiesForTest("")
	if len(got) != 2 || got[0] != "127.0.0.1" || got[1] != "::1" {
		t.Fatalf("default trusted proxies = %#v, want [127.0.0.1 ::1]", got)
	}
}

func TestResolveTrustedProxiesNone(t *testing.T) {
	for _, raw := range []string{"none", "false", "OFF"} {
		got := ResolveTrustedProxiesForTest(raw)
		if len(got) != 0 {
			t.Fatalf("TRUSTED_PROXIES=%q => %#v, want empty", raw, got)
		}
	}
}

func TestResolveTrustedProxiesExplicit(t *testing.T) {
	got := ResolveTrustedProxiesForTest("10.0.0.0/8, 192.168.1.1")
	if len(got) != 2 || got[0] != "10.0.0.0/8" || got[1] != "192.168.1.1" {
		t.Fatalf("explicit parse = %#v", got)
	}
}

func TestClientIPIgnoresSpoofedXFFFromUntrustedPeer(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if err := r.SetTrustedProxies([]string{"127.0.0.1", "::1"}); err != nil {
		t.Fatal(err)
	}
	r.ForwardedByClientIP = true

	var gotIP string
	r.GET("/ip", func(c *gin.Context) {
		gotIP = c.ClientIP()
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/ip", nil)
	req.RemoteAddr = "203.0.113.50:54321"
	req.Header.Set("X-Forwarded-For", "10.0.0.1")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if gotIP != "203.0.113.50" {
		t.Fatalf("ClientIP from untrusted peer with spoofed XFF = %q, want remote 203.0.113.50", gotIP)
	}
}

func TestClientIPHonorsXFFFromTrustedLoopback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if err := r.SetTrustedProxies([]string{"127.0.0.1", "::1"}); err != nil {
		t.Fatal(err)
	}
	r.ForwardedByClientIP = true

	var gotIP string
	r.GET("/ip", func(c *gin.Context) {
		gotIP = c.ClientIP()
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/ip", nil)
	req.RemoteAddr = "127.0.0.1:4444"
	req.Header.Set("X-Forwarded-For", "198.51.100.20")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if gotIP != "198.51.100.20" {
		t.Fatalf("ClientIP from trusted loopback = %q, want 198.51.100.20", gotIP)
	}
}
