package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/circuitbreaker"
	"github.com/proxyhubb/control-api/internal/logging"
)

// CircuitBreakerManager manages multiple circuit breakers for different services
type CircuitBreakerManager struct {
	breakers map[string]*circuitbreaker.CircuitBreaker
	mutex    sync.RWMutex
}

var (
	// Global circuit breaker manager
	cbManager = &CircuitBreakerManager{
		breakers: make(map[string]*circuitbreaker.CircuitBreaker),
	}
)

// GetCircuitBreaker returns or creates a circuit breaker for the given service
func (m *CircuitBreakerManager) GetCircuitBreaker(serviceName string, config circuitbreaker.Config) *circuitbreaker.CircuitBreaker {
	m.mutex.RLock()
	if cb, exists := m.breakers[serviceName]; exists {
		m.mutex.RUnlock()
		return cb
	}
	m.mutex.RUnlock()

	m.mutex.Lock()
	defer m.mutex.Unlock()

	// Double-check after acquiring write lock
	if cb, exists := m.breakers[serviceName]; exists {
		return cb
	}

	// Create new circuit breaker
	cb := circuitbreaker.New(config)
	cb.OnStateChange(func(from, to circuitbreaker.State) {
		logging.Info().
			Str("service", serviceName).
			Str("from_state", from.String()).
			Str("to_state", to.String()).
			Msg("Circuit breaker state changed")
	})

	m.breakers[serviceName] = cb
	return cb
}

// GetAllStats returns statistics for all circuit breakers
func (m *CircuitBreakerManager) GetAllStats() map[string]circuitbreaker.Stats {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	stats := make(map[string]circuitbreaker.Stats)
	for name, cb := range m.breakers {
		stats[name] = cb.Stats()
	}
	return stats
}

// CircuitBreakerMiddleware creates middleware for protecting downstream service calls
func CircuitBreakerMiddleware(serviceName string, config circuitbreaker.Config) gin.HandlerFunc {
	cb := cbManager.GetCircuitBreaker(serviceName, config)

	return func(c *gin.Context) {
		// Store circuit breaker in context for use by handlers
		c.Set("circuit_breaker_"+serviceName, cb)
		c.Next()
	}
}

// HTTPClientWithCircuitBreaker wraps an HTTP client with circuit breaker protection
type HTTPClientWithCircuitBreaker struct {
	client          *http.Client
	circuitBreaker  *circuitbreaker.CircuitBreaker
	serviceName     string
}

// NewHTTPClientWithCircuitBreaker creates a new HTTP client with circuit breaker protection
func NewHTTPClientWithCircuitBreaker(serviceName string, config circuitbreaker.Config) *HTTPClientWithCircuitBreaker {
	return &HTTPClientWithCircuitBreaker{
		client:         &http.Client{Timeout: config.RequestTimeout},
		circuitBreaker: cbManager.GetCircuitBreaker(serviceName, config),
		serviceName:    serviceName,
	}
}

// Do executes an HTTP request with circuit breaker protection
func (c *HTTPClientWithCircuitBreaker) Do(req *http.Request) (*http.Response, error) {
	var resp *http.Response
	var err error

	cbErr := c.circuitBreaker.CallWithTimeout(func() error {
		resp, err = c.client.Do(req)
		
		// Consider HTTP errors as failures
		if err != nil {
			return err
		}
		
		// Consider 5xx status codes as failures
		if resp.StatusCode >= 500 {
			return &HTTPError{
				StatusCode: resp.StatusCode,
				Message:    "Server error",
			}
		}
		
		return nil
	})

	if cbErr != nil {
		// Circuit breaker error (open circuit, timeout, etc.)
		return nil, cbErr
	}

	return resp, err
}

// HTTPError represents an HTTP error
type HTTPError struct {
	StatusCode int
	Message    string
}

func (e *HTTPError) Error() string {
	return e.Message
}

// CircuitBreakerStatsHandler returns circuit breaker statistics
func CircuitBreakerStatsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		stats := cbManager.GetAllStats()
		c.JSON(http.StatusOK, gin.H{
			"circuit_breakers": stats,
			"timestamp":       time.Now(),
		})
	}
}

// GetCircuitBreakerFromContext retrieves a circuit breaker from the Gin context
func GetCircuitBreakerFromContext(c *gin.Context, serviceName string) (*circuitbreaker.CircuitBreaker, bool) {
	cb, exists := c.Get("circuit_breaker_" + serviceName)
	if !exists {
		return nil, false
	}
	
	circuitBreaker, ok := cb.(*circuitbreaker.CircuitBreaker)
	return circuitBreaker, ok
}

// ProtectedServiceCall executes a service call with circuit breaker protection
func ProtectedServiceCall(c *gin.Context, serviceName string, fn func() error) error {
	cb, exists := GetCircuitBreakerFromContext(c, serviceName)
	if !exists {
		// No circuit breaker configured, execute directly
		return fn()
	}
	
	return cb.CallWithTimeout(fn)
}

// DefaultCircuitBreakerConfigs provides default configurations for common services
var DefaultCircuitBreakerConfigs = map[string]circuitbreaker.Config{
	"database": {
		MaxFailures:      3,
		ResetTimeout:     30 * time.Second,
		SuccessThreshold: 2,
		RequestTimeout:   5 * time.Second,
	},
	"redis": {
		MaxFailures:      5,
		ResetTimeout:     15 * time.Second,
		SuccessThreshold: 3,
		RequestTimeout:   2 * time.Second,
	},
	"solana": {
		MaxFailures:      3,
		ResetTimeout:     60 * time.Second,
		SuccessThreshold: 2,
		RequestTimeout:   10 * time.Second,
	},
	"external_api": {
		MaxFailures:      5,
		ResetTimeout:     45 * time.Second,
		SuccessThreshold: 3,
		RequestTimeout:   15 * time.Second,
	},
}