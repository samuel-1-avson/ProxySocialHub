package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func metricsTestRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/metrics", RequireMetricsAccess(), func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})
	return r
}

func TestMetricsAuth_InternalScrapeAllowed(t *testing.T) {
	t.Setenv(metricsTokenEnv, "")
	r := metricsTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req.Host = "control-api:8080"
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("internal scrape got %d, want 200", w.Code)
	}
}

func TestMetricsAuth_PublicHostDenied(t *testing.T) {
	t.Setenv(metricsTokenEnv, "")
	r := metricsTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req.Host = "api.proxyhubb.com"
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("public host got %d, want 404", w.Code)
	}
}

func TestMetricsAuth_ForwardedDenied(t *testing.T) {
	t.Setenv(metricsTokenEnv, "")
	r := metricsTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req.Host = "127.0.0.1:8080"
	req.Header.Set("X-Forwarded-For", "203.0.113.9")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("forwarded scrape got %d, want 404", w.Code)
	}
}

func TestMetricsAuth_TokenRequiredWhenSet(t *testing.T) {
	t.Setenv(metricsTokenEnv, "secret-metrics")
	r := metricsTestRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req.Host = "control-api:8080"
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("missing token got %d, want 404", w.Code)
	}

	req2 := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req2.Host = "api.proxyhubb.com"
	req2.Header.Set("Authorization", "Bearer secret-metrics")
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("bearer token got %d, want 200", w2.Code)
	}

	req3 := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req3.Host = "control-api:8080"
	req3.Header.Set("X-Metrics-Token", "secret-metrics")
	w3 := httptest.NewRecorder()
	r.ServeHTTP(w3, req3)
	if w3.Code != http.StatusOK {
		t.Fatalf("header token got %d, want 200", w3.Code)
	}

	req4 := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req4.Host = "control-api:8080"
	req4.Header.Set("Authorization", "Bearer wrong")
	w4 := httptest.NewRecorder()
	r.ServeHTTP(w4, req4)
	if w4.Code != http.StatusNotFound {
		t.Fatalf("wrong token got %d, want 404", w4.Code)
	}
}
