package ratelimiter

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

var (
	memoryLimiterMu sync.Mutex
	memoryLimiters  = make(map[string]*rate.Limiter)
)

// checkMemoryTokenBucket applies per-process rate limiting when Redis is unavailable.
func checkMemoryTokenBucket(key string, config AdvancedRateLimitConfig) (allowed bool, remaining int, resetTime time.Time) {
	perSecond := float64(config.Limit) / config.Window.Seconds()
	if perSecond <= 0 {
		perSecond = 1
	}
	burst := config.BurstCapacity
	if burst < 1 {
		burst = config.Limit
	}
	if burst < 1 {
		burst = 1
	}

	memoryLimiterMu.Lock()
	lim, ok := memoryLimiters[key]
	if !ok {
		lim = rate.NewLimiter(rate.Limit(perSecond), burst)
		memoryLimiters[key] = lim
	}
	memoryLimiterMu.Unlock()

	allowed = lim.Allow()
	tokens := int(lim.Tokens())
	if tokens < 0 {
		tokens = 0
	}
	remaining = tokens
	resetTime = time.Now().Add(config.Window)
	return allowed, remaining, resetTime
}
