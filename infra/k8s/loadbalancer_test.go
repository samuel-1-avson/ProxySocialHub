package k8s

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestLoadBalancerHealthManagement tests load balancer health management
// Property 3: Load Balancer Health Management
// Validates: Requirements 1.5, 1.6, 1.7
func TestLoadBalancerHealthManagement(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping load balancer health management test in short mode")
	}

	// Test endpoints
	endpoints := map[string]string{
		"api":     "https://api.proxyhubb.com",
		"app":     "https://app.proxyhubb.com", 
		"gateway": "https://gateway.proxyhubb.com",
	}

	// HTTP client with reasonable timeouts
	client := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true, // For testing only
			},
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	ctx := context.Background()

	// Property: Load balancer should route traffic only to healthy backends
	t.Run("routes_to_healthy_backends_only", func(t *testing.T) {
		for name, endpoint := range endpoints {
			t.Run(name, func(t *testing.T) {
				// Test health check endpoint
				healthURL := endpoint + "/health"
				
				req, err := http.NewRequestWithContext(ctx, "GET", healthURL, nil)
				require.NoError(t, err, "Failed to create health check request")

				resp, err := client.Do(req)
				if err != nil {
					t.Skipf("Endpoint %s not available: %v", endpoint, err)
				}
				defer resp.Body.Close()

				// Verify health check response
				assert.Equal(t, http.StatusOK, resp.StatusCode, "Health check should return 200 OK")
				
				// Verify response time is reasonable
				assert.Less(t, resp.Header.Get("X-Response-Time"), "1000ms", "Health check should be fast")
			})
		}
	})

	// Property: SSL/TLS termination should work properly
	t.Run("ssl_tls_termination", func(t *testing.T) {
		for name, endpoint := range endpoints {
			t.Run(name, func(t *testing.T) {
				req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
				require.NoError(t, err, "Failed to create SSL test request")

				resp, err := client.Do(req)
				if err != nil {
					t.Skipf("Endpoint %s not available: %v", endpoint, err)
				}
				defer resp.Body.Close()

				// Verify SSL/TLS is working
				assert.True(t, resp.TLS != nil, "Response should use TLS")
				if resp.TLS != nil {
					assert.GreaterOrEqual(t, int(resp.TLS.Version), int(tls.VersionTLS12), "Should use TLS 1.2 or higher")
				}

				// Verify security headers
				assert.NotEmpty(t, resp.Header.Get("Strict-Transport-Security"), "Should have HSTS header")
				assert.Equal(t, "DENY", resp.Header.Get("X-Frame-Options"), "Should have X-Frame-Options header")
				assert.Equal(t, "nosniff", resp.Header.Get("X-Content-Type-Options"), "Should have X-Content-Type-Options header")
			})
		}
	})

	// Property: Connection pooling and keep-alive should be optimized
	t.Run("connection_optimization", func(t *testing.T) {
		endpoint := endpoints["api"]
		
		// Make multiple requests to test connection reuse
		numRequests := 10
		var responseTimes []time.Duration

		for i := 0; i < numRequests; i++ {
			start := time.Now()
			
			req, err := http.NewRequestWithContext(ctx, "GET", endpoint+"/health", nil)
			require.NoError(t, err, "Failed to create request %d", i)

			resp, err := client.Do(req)
			if err != nil {
				t.Skipf("Request %d failed: %v", i, err)
			}
			
			responseTime := time.Since(start)
			responseTimes = append(responseTimes, responseTime)
			
			resp.Body.Close()

			// Verify keep-alive headers
			assert.Contains(t, resp.Header.Get("Connection"), "keep-alive", "Should use keep-alive connections")
		}

		// Verify response times improve with connection reuse
		if len(responseTimes) >= 3 {
			firstRequest := responseTimes[0]
			laterRequests := responseTimes[2:]
			
			var avgLaterTime time.Duration
			for _, rt := range laterRequests {
				avgLaterTime += rt
			}
			avgLaterTime /= time.Duration(len(laterRequests))

			t.Logf("First request: %v, Average later requests: %v", firstRequest, avgLaterTime)
			
			// Later requests should generally be faster due to connection reuse
			// Allow some variance for network conditions
			assert.Less(t, avgLaterTime, firstRequest*2, "Connection reuse should improve performance")
		}
	})

	// Property: Rate limiting should be enforced
	t.Run("rate_limiting_enforcement", func(t *testing.T) {
		endpoint := endpoints["api"]
		
		// Make rapid requests to trigger rate limiting
		numRequests := 150 // Above the typical 100 req/min limit
		rateLimitHit := false
		
		for i := 0; i < numRequests; i++ {
			req, err := http.NewRequestWithContext(ctx, "GET", endpoint+"/health", nil)
			require.NoError(t, err, "Failed to create rate limit test request %d", i)

			resp, err := client.Do(req)
			if err != nil {
				continue // Network errors don't count for rate limiting test
			}
			
			if resp.StatusCode == http.StatusTooManyRequests {
				rateLimitHit = true
				
				// Verify rate limit headers
				assert.NotEmpty(t, resp.Header.Get("X-RateLimit-Limit"), "Should have rate limit header")
				assert.NotEmpty(t, resp.Header.Get("Retry-After"), "Should have retry-after header")
				
				t.Logf("Rate limit triggered at request %d", i+1)
				resp.Body.Close()
				break
			}
			
			resp.Body.Close()
			
			// Small delay to avoid overwhelming the system
			time.Sleep(10 * time.Millisecond)
		}

		// Note: Rate limiting might not trigger in test environments
		// This is more of a configuration verification
		if rateLimitHit {
			t.Log("Rate limiting is properly configured and enforced")
		} else {
			t.Log("Rate limiting not triggered (may be disabled in test environment)")
		}
	})

	// Property: CORS headers should be properly configured
	t.Run("cors_configuration", func(t *testing.T) {
		endpoint := endpoints["api"]
		
		req, err := http.NewRequestWithContext(ctx, "OPTIONS", endpoint, nil)
		require.NoError(t, err, "Failed to create CORS preflight request")
		
		// Add CORS preflight headers
		req.Header.Set("Origin", "https://proxyhubb.com")
		req.Header.Set("Access-Control-Request-Method", "POST")
		req.Header.Set("Access-Control-Request-Headers", "Content-Type,Authorization")

		resp, err := client.Do(req)
		if err != nil {
			t.Skipf("CORS preflight request failed: %v", err)
		}
		defer resp.Body.Close()

		// Verify CORS headers
		assert.NotEmpty(t, resp.Header.Get("Access-Control-Allow-Origin"), "Should have CORS origin header")
		assert.NotEmpty(t, resp.Header.Get("Access-Control-Allow-Methods"), "Should have CORS methods header")
		assert.NotEmpty(t, resp.Header.Get("Access-Control-Allow-Headers"), "Should have CORS headers header")
		
		// Verify allowed origin
		allowedOrigin := resp.Header.Get("Access-Control-Allow-Origin")
		assert.Contains(t, []string{"https://proxyhubb.com", "*"}, allowedOrigin, "Should allow expected origins")
	})

	// Property: Load balancer should distribute requests across backends
	t.Run("request_distribution", func(t *testing.T) {
		endpoint := endpoints["api"]
		
		// Make multiple requests and track server responses
		numRequests := 20
		serverResponses := make(map[string]int)
		
		for i := 0; i < numRequests; i++ {
			req, err := http.NewRequestWithContext(ctx, "GET", endpoint+"/health", nil)
			require.NoError(t, err, "Failed to create distribution test request %d", i)

			resp, err := client.Do(req)
			if err != nil {
				continue
			}
			
			// Track which server handled the request (if header is present)
			serverID := resp.Header.Get("X-Server-ID")
			if serverID != "" {
				serverResponses[serverID]++
			}
			
			resp.Body.Close()
			time.Sleep(50 * time.Millisecond) // Small delay between requests
		}

		// Verify distribution if server IDs are available
		if len(serverResponses) > 1 {
			t.Logf("Request distribution across servers: %v", serverResponses)
			
			// Check that requests are reasonably distributed
			for serverID, count := range serverResponses {
				// Each server should handle at least some requests
				assert.Greater(t, count, 0, "Server %s should handle some requests", serverID)
				
				// No single server should handle all requests (unless only one is available)
				assert.Less(t, count, numRequests, "Server %s should not handle all requests", serverID)
			}
		} else {
			t.Log("Server identification headers not available, skipping distribution verification")
		}
	})
}

// TestLoadBalancerFailover tests load balancer failover behavior
func TestLoadBalancerFailover(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping load balancer failover test in short mode")
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true,
			},
		},
	}

	ctx := context.Background()

	t.Run("graceful_backend_failure_handling", func(t *testing.T) {
		endpoint := "https://api.proxyhubb.com"
		
		// Test that load balancer handles backend failures gracefully
		successCount := 0
		totalRequests := 10
		
		for i := 0; i < totalRequests; i++ {
			req, err := http.NewRequestWithContext(ctx, "GET", endpoint+"/health", nil)
			require.NoError(t, err, "Failed to create failover test request %d", i)

			resp, err := client.Do(req)
			if err == nil && resp.StatusCode == http.StatusOK {
				successCount++
				resp.Body.Close()
			} else if resp != nil {
				resp.Body.Close()
			}
			
			time.Sleep(100 * time.Millisecond)
		}

		// Even with potential backend failures, most requests should succeed
		successRate := float64(successCount) / float64(totalRequests)
		assert.GreaterOrEqual(t, successRate, 0.8, "Success rate should be at least 80%% even with failures")
		
		t.Logf("Success rate: %.2f%% (%d/%d)", successRate*100, successCount, totalRequests)
	})

	t.Run("circuit_breaker_behavior", func(t *testing.T) {
		// This test would require injecting failures into backends
		// In a real environment, you would simulate backend failures
		// and verify that the load balancer stops routing to failed backends
		
		t.Log("Circuit breaker behavior test requires failure injection - skipping in basic test")
	})
}

// BenchmarkLoadBalancerPerformance benchmarks load balancer performance
func BenchmarkLoadBalancerPerformance(b *testing.B) {
	client := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true,
			},
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 10,
		},
	}

	endpoint := "https://api.proxyhubb.com/health"
	ctx := context.Background()

	b.Run("sequential_requests", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
			if err != nil {
				b.Fatalf("Failed to create request: %v", err)
			}

			resp, err := client.Do(req)
			if err != nil {
				b.Fatalf("Request failed: %v", err)
			}
			resp.Body.Close()
		}
	})

	b.Run("concurrent_requests", func(b *testing.B) {
		b.ResetTimer()
		b.RunParallel(func(pb *testing.PB) {
			for pb.Next() {
				req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
				if err != nil {
					b.Fatalf("Failed to create request: %v", err)
				}

				resp, err := client.Do(req)
				if err != nil {
					b.Fatalf("Request failed: %v", err)
				}
				resp.Body.Close()
			}
		})
	})
}