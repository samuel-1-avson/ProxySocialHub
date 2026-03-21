package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

func TestRateLimitMiddleware(t *testing.T) {
	// Setup miniredis
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("Failed to start miniredis: %v", err)
	}
	defer mr.Close()

	// Configure redis client to use miniredis
	client := redis.NewClient(&redis.Options{
		Addr: mr.Addr(),
	})
	redisClient.Client = client

	gin.SetMode(gin.TestMode)
	r := gin.New()
	
	// Use a custom limiter with low limit for testing
	customLimiter := RateLimitWithConfig(6, time.Minute)
	r.Use(customLimiter)
	r.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// First 3 requests should succeed
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest("GET", "/test", nil)
		req.RemoteAddr = "192.168.1.1:12345"
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("Request %d: expected 200, got %d", i+1, w.Code)
		}
	}

	// 4th request should be rate limited
	req := httptest.NewRequest("GET", "/test", nil)
	req.RemoteAddr = "192.168.1.1:12345"
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusTooManyRequests {
		t.Errorf("Expected 429, got %d", w.Code)
	}
}

func TestValidateEmail(t *testing.T) {
	tests := []struct {
		email string
		valid bool
	}{
		{"test@example.com", true},
		{"user@domain.co.uk", true},
		{"a@b.cc", true},
		{"invalid", false},
		{"@nodomain.com", false},
		{"nodomain@", false},
		{"", false},
		{"a", false},
	}

	for _, tt := range tests {
		result := ValidateEmail(tt.email)
		if result != tt.valid {
			t.Errorf("ValidateEmail(%s): expected %v, got %v", tt.email, tt.valid, result)
		}
	}
}

func TestValidatePhone(t *testing.T) {
	tests := []struct {
		phone string
		valid bool
	}{
		{"0241234567", true},
		{"+233241234567", true},
		{"024-123-4567", true},
		{"024 123 4567", true},
		{"123", false},
		{"", false},
		{"abcdefghij", false},
		{"12345678901234567890", false},
	}

	for _, tt := range tests {
		result := ValidatePhone(tt.phone)
		if result != tt.valid {
			t.Errorf("ValidatePhone(%s): expected %v, got %v", tt.phone, tt.valid, result)
		}
	}
}

func TestSanitizeInput(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"hello world", "hello world"},
		{"hello\x00world", "helloworld"},           // Null byte removed
		{"hello\x01\x02\x03world", "helloworld"},   // Control chars removed
		{"hello\nworld", "hello\nworld"},           // Newline kept
		{"hello\tworld", "hello\tworld"},           // Tab kept
	}

	for _, tt := range tests {
		result := SanitizeInput(tt.input)
		if result != tt.expected {
			t.Errorf("SanitizeInput(%q): expected %q, got %q", tt.input, tt.expected, result)
		}
	}
}

func TestSecureHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(SecureHeaders())
	r.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	expectedHeaders := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"X-XSS-Protection":       "1; mode=block",
		"Cache-Control":          "no-store",
	}

	for header, expected := range expectedHeaders {
		actual := w.Header().Get(header)
		if actual != expected {
			t.Errorf("Header %s: expected %q, got %q", header, expected, actual)
		}
	}
}

func TestInputValidationMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(InputValidationMiddleware())
	r.POST("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Test valid Content-Type
	req := httptest.NewRequest("POST", "/test", nil)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200 for valid Content-Type, got %d", w.Code)
	}

	// Test invalid Content-Type
	req = httptest.NewRequest("POST", "/test", nil)
	req.Header.Set("Content-Type", "text/xml")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnsupportedMediaType {
		t.Errorf("Expected 415 for invalid Content-Type, got %d", w.Code)
	}
}
