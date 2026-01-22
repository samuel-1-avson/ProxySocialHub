package middleware

import (
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/redis"
)

// WAFConfig defines Web Application Firewall configuration
type WAFConfig struct {
	// Enable/disable WAF
	Enabled bool
	// Block SQL injection attempts
	BlockSQLInjection bool
	// Block XSS attempts
	BlockXSS bool
	// Block path traversal attempts
	BlockPathTraversal bool
	// Block common attack patterns
	BlockCommonAttacks bool
	// Enable IP reputation checking
	EnableIPReputation bool
	// Enable geo-blocking
	EnableGeoBlocking bool
	// Blocked countries (ISO 3166-1 alpha-2 codes)
	BlockedCountries []string
	// Whitelisted IPs (bypass all checks)
	WhitelistedIPs []string
	// Blacklisted IPs (always block)
	BlacklistedIPs []string
	// Challenge threshold (suspicious requests before challenge)
	ChallengeThreshold int
	// Ban threshold (challenges failed before ban)
	BanThreshold int
	// Ban duration
	BanDuration time.Duration
}

// DefaultWAFConfig returns sensible WAF defaults
func DefaultWAFConfig() WAFConfig {
	return WAFConfig{
		Enabled:            true,
		BlockSQLInjection:  true,
		BlockXSS:           true,
		BlockPathTraversal: true,
		BlockCommonAttacks: true,
		EnableIPReputation: true,
		EnableGeoBlocking:  false,
		BlockedCountries:   []string{},
		WhitelistedIPs:     []string{"127.0.0.1", "::1"},
		BlacklistedIPs:     []string{},
		ChallengeThreshold: 10,
		BanThreshold:       3,
		BanDuration:        time.Hour * 24,
	}
}

// Attack patterns
var (
	sqlInjectionPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(union\s+select|select\s+.*\s+from|insert\s+into|delete\s+from|drop\s+table|update\s+.*\s+set)`),
		regexp.MustCompile(`(?i)(or\s+1\s*=\s*1|and\s+1\s*=\s*1|'\s*or\s*'|"\s*or\s*")`),
		regexp.MustCompile(`(?i)(;\s*drop|;\s*delete|;\s*insert|;\s*update)`),
		regexp.MustCompile(`(?i)(--\s*$|#\s*$|/\*.*\*/)`),
		regexp.MustCompile(`(?i)(benchmark\s*\(|sleep\s*\(|waitfor\s+delay)`),
	}

	xssPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)<script[^>]*>.*</script>`),
		regexp.MustCompile(`(?i)javascript\s*:`),
		regexp.MustCompile(`(?i)on(load|error|click|mouse|focus|blur)\s*=`),
		regexp.MustCompile(`(?i)<iframe[^>]*>`),
		regexp.MustCompile(`(?i)<object[^>]*>`),
		regexp.MustCompile(`(?i)expression\s*\(`),
		regexp.MustCompile(`(?i)eval\s*\(`),
	}

	pathTraversalPatterns = []*regexp.Regexp{
		regexp.MustCompile(`\.\.(/|\\)`),
		regexp.MustCompile(`%2e%2e(%2f|%5c)`),
		regexp.MustCompile(`%252e%252e(%252f|%255c)`),
		regexp.MustCompile(`/etc/passwd`),
		regexp.MustCompile(`/proc/self`),
		regexp.MustCompile(`c:\\windows`),
	}

	commonAttackPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(cmd\.exe|powershell|/bin/sh|/bin/bash)`),
		regexp.MustCompile(`(?i)(phpinfo\s*\(|system\s*\(|exec\s*\(|passthru\s*\()`),
		regexp.MustCompile(`(?i)(\$\{.*\}|%\{.*\})`), // Log4j style
		regexp.MustCompile(`(?i)(base64_decode|gzinflate|str_rot13)`),
		regexp.MustCompile(`(?i)(wget\s+|curl\s+|fetch\s+)http`),
	}
)

// IPReputation tracks suspicious activity per IP
type IPReputation struct {
	mu              sync.RWMutex
	suspiciousCount map[string]int
	challengeCount  map[string]int
	bannedUntil     map[string]time.Time
}

var ipReputation = &IPReputation{
	suspiciousCount: make(map[string]int),
	challengeCount:  make(map[string]int),
	bannedUntil:     make(map[string]time.Time),
}

// WAFMiddleware creates Web Application Firewall middleware
func WAFMiddleware(config WAFConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !config.Enabled {
			c.Next()
			return
		}

		clientIP := c.ClientIP()

		// Check whitelist
		if isIPWhitelisted(clientIP, config.WhitelistedIPs) {
			c.Next()
			return
		}

		// Check blacklist
		if isIPBlacklisted(clientIP, config.BlacklistedIPs) {
			logging.Warn().Str("ip", maskIP(clientIP)).Msg("WAF: Blacklisted IP blocked")
			c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
			c.Abort()
			return
		}

		// Check if IP is banned
		if isBanned(clientIP) {
			logging.Warn().Str("ip", maskIP(clientIP)).Msg("WAF: Banned IP blocked")
			c.JSON(http.StatusForbidden, gin.H{"error": "You have been temporarily banned"})
			c.Abort()
			return
		}

		// Check for attacks
		attackType := detectAttack(c, config)
		if attackType != "" {
			recordSuspiciousActivity(clientIP, attackType, config)
			
			logging.Warn().
				Str("ip", maskIP(clientIP)).
				Str("attack_type", attackType).
				Str("path", c.Request.URL.Path).
				Str("method", c.Request.Method).
				Msg("WAF: Attack detected and blocked")

			c.JSON(http.StatusForbidden, gin.H{
				"error":   "Request blocked by security policy",
				"code":    "WAF_BLOCKED",
			})
			c.Abort()
			return
		}

		// Set security headers
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-XSS-Protection", "1; mode=block")

		c.Next()
	}
}

// detectAttack checks request for attack patterns
func detectAttack(c *gin.Context, config WAFConfig) string {
	// Collect all input to check
	inputs := []string{
		c.Request.URL.RawQuery,
		c.Request.URL.Path,
	}

	// Check headers
	for _, values := range c.Request.Header {
		inputs = append(inputs, values...)
	}

	// Check body (limited to prevent DoS)
	// Body is typically checked in specific handlers

	for _, input := range inputs {
		if input == "" {
			continue
		}

		// SQL Injection
		if config.BlockSQLInjection {
			for _, pattern := range sqlInjectionPatterns {
				if pattern.MatchString(input) {
					return "sql_injection"
				}
			}
		}

		// XSS
		if config.BlockXSS {
			for _, pattern := range xssPatterns {
				if pattern.MatchString(input) {
					return "xss"
				}
			}
		}

		// Path Traversal
		if config.BlockPathTraversal {
			for _, pattern := range pathTraversalPatterns {
				if pattern.MatchString(input) {
					return "path_traversal"
				}
			}
		}

		// Common Attacks
		if config.BlockCommonAttacks {
			for _, pattern := range commonAttackPatterns {
				if pattern.MatchString(input) {
					return "common_attack"
				}
			}
		}
	}

	return ""
}

// recordSuspiciousActivity tracks suspicious activity and applies penalties
func recordSuspiciousActivity(ip, attackType string, config WAFConfig) {
	ipReputation.mu.Lock()
	defer ipReputation.mu.Unlock()

	ipReputation.suspiciousCount[ip]++
	count := ipReputation.suspiciousCount[ip]

	// Store in Redis for distributed tracking
	if redis.Client != nil {
		key := "waf:suspicious:" + ip
		redis.Client.Incr(ctx, key)
		redis.Client.Expire(ctx, key, time.Hour)
	}

	// Apply ban if threshold exceeded
	if count >= config.ChallengeThreshold {
		ipReputation.challengeCount[ip]++
		
		if ipReputation.challengeCount[ip] >= config.BanThreshold {
			banUntil := time.Now().Add(config.BanDuration)
			ipReputation.bannedUntil[ip] = banUntil
			
			// Store ban in Redis
			if redis.Client != nil {
				redis.Client.Set(ctx, "waf:banned:"+ip, banUntil.Unix(), config.BanDuration)
			}
			
			logging.Warn().
				Str("ip", maskIP(ip)).
				Time("banned_until", banUntil).
				Msg("WAF: IP banned due to repeated attacks")
		}
	}
}

// isBanned checks if an IP is currently banned
func isBanned(ip string) bool {
	// Check Redis first for distributed state
	if redis.Client != nil {
		_, err := redis.Client.Get(ctx, "waf:banned:"+ip).Result()
		if err == nil {
			return true
		}
	}

	ipReputation.mu.RLock()
	defer ipReputation.mu.RUnlock()

	if banTime, exists := ipReputation.bannedUntil[ip]; exists {
		return time.Now().Before(banTime)
	}
	return false
}

// isIPWhitelisted checks if IP is in whitelist
func isIPWhitelisted(ip string, whitelist []string) bool {
	for _, whitelisted := range whitelist {
		if ip == whitelisted {
			return true
		}
		// Check CIDR
		if strings.Contains(whitelisted, "/") {
			_, network, err := net.ParseCIDR(whitelisted)
			if err == nil && network.Contains(net.ParseIP(ip)) {
				return true
			}
		}
	}
	return false
}

// isIPBlacklisted checks if IP is in blacklist
func isIPBlacklisted(ip string, blacklist []string) bool {
	for _, blacklisted := range blacklist {
		if ip == blacklisted {
			return true
		}
		if strings.Contains(blacklisted, "/") {
			_, network, err := net.ParseCIDR(blacklisted)
			if err == nil && network.Contains(net.ParseIP(ip)) {
				return true
			}
		}
	}
	return false
}

// maskIP masks an IP for safe logging
func maskIP(ip string) string {
	if len(ip) <= 8 {
		return ip[:2] + "***"
	}
	return ip[:4] + "***"
}

// WAFStats returns WAF statistics
type WAFStats struct {
	BlockedRequests   int64            `json:"blocked_requests"`
	BannedIPs         int              `json:"banned_ips"`
	AttacksByType     map[string]int64 `json:"attacks_by_type"`
	TopOffendingIPs   []string         `json:"top_offending_ips"`
}

// WAFStatsHandler returns WAF statistics endpoint
func WAFStatsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		ipReputation.mu.RLock()
		bannedCount := len(ipReputation.bannedUntil)
		ipReputation.mu.RUnlock()

		stats := WAFStats{
			BannedIPs:     bannedCount,
			AttacksByType: make(map[string]int64),
		}

		c.JSON(http.StatusOK, stats)
	}
}

// DDoSConfig defines DDoS protection configuration
type DDoSConfig struct {
	// Enable DDoS protection
	Enabled bool
	// Maximum requests per second per IP
	MaxRequestsPerSecond int
	// Burst capacity
	BurstCapacity int
	// Connection limit per IP
	ConnectionLimit int
	// Slow request threshold (seconds)
	SlowRequestThreshold time.Duration
	// Enable SYN flood protection (header-based detection)
	EnableSYNFloodProtection bool
}

// DefaultDDoSConfig returns default DDoS protection config
func DefaultDDoSConfig() DDoSConfig {
	return DDoSConfig{
		Enabled:                  true,
		MaxRequestsPerSecond:     50,
		BurstCapacity:            100,
		ConnectionLimit:          100,
		SlowRequestThreshold:     30 * time.Second,
		EnableSYNFloodProtection: true,
	}
}

// DDoSProtectionMiddleware creates DDoS protection middleware
func DDoSProtectionMiddleware(config DDoSConfig) gin.HandlerFunc {
	requestCounters := &sync.Map{}
	
	// Cleanup goroutine
	go func() {
		ticker := time.NewTicker(time.Minute)
		for range ticker.C {
			requestCounters.Range(func(key, value any) bool {
				requestCounters.Delete(key)
				return true
			})
		}
	}()

	return func(c *gin.Context) {
		if !config.Enabled {
			c.Next()
			return
		}

		clientIP := c.ClientIP()
		now := time.Now().Unix()
		key := clientIP + ":" + string(rune(now))

		// Get or create counter
		counter, _ := requestCounters.LoadOrStore(key, &struct{ count int }{0})
		cnt := counter.(*struct{ count int })
		cnt.count++

		// Check rate
		if cnt.count > config.MaxRequestsPerSecond {
			logging.Warn().
				Str("ip", maskIP(clientIP)).
				Int("rate", cnt.count).
				Msg("DDoS: Rate limit exceeded")

			c.Header("Retry-After", "1")
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Rate limit exceeded",
				"code":  "DDOS_PROTECTION",
			})
			c.Abort()
			return
		}

		// Check for suspicious headers (potential SYN flood indicators)
		if config.EnableSYNFloodProtection {
			if c.GetHeader("X-Forwarded-For") != "" && len(strings.Split(c.GetHeader("X-Forwarded-For"), ",")) > 10 {
				logging.Warn().Str("ip", maskIP(clientIP)).Msg("DDoS: Suspicious X-Forwarded-For chain")
				c.JSON(http.StatusForbidden, gin.H{"error": "Suspicious request"})
				c.Abort()
				return
			}
		}

		c.Next()
	}
}
