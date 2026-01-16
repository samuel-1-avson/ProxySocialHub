package logging

import (
	"io"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

var Logger zerolog.Logger

// Init initializes the structured logger
func Init() {
	env := os.Getenv("ENV")

	var output io.Writer
	if env == "production" {
		// JSON output for production (log aggregation)
		output = os.Stdout
	} else {
		// Pretty console output for development
		output = zerolog.ConsoleWriter{
			Out:        os.Stdout,
			TimeFormat: time.RFC3339,
		}
	}

	Logger = zerolog.New(output).
		With().
		Timestamp().
		Caller().
		Logger()

	// Set global logger
	log.Logger = Logger

	Logger.Info().Msg("Logger initialized")
}

// RequestLogger middleware for structured request logging
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		query := c.Request.URL.RawQuery

		// Process request
		c.Next()

		// Calculate latency
		latency := time.Since(start)

		// Get user ID if available
		userID := ""
		if id, exists := c.Get("userID"); exists {
			userID = id.(string)
		}

		// Get request ID from header or generate
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" {
			requestID = c.GetString("requestID")
		}

		// Log the request
		event := Logger.Info()
		if c.Writer.Status() >= 400 {
			event = Logger.Warn()
		}
		if c.Writer.Status() >= 500 {
			event = Logger.Error()
		}

		event.
			Str("request_id", requestID).
			Str("method", c.Request.Method).
			Str("path", path).
			Str("query", query).
			Int("status", c.Writer.Status()).
			Dur("latency", latency).
			Str("ip", c.ClientIP()).
			Str("user_agent", c.Request.UserAgent()).
			Str("user_id", userID).
			Int("body_size", c.Writer.Size()).
			Msg("request")

		// Log errors if any
		if len(c.Errors) > 0 {
			for _, e := range c.Errors {
				Logger.Error().
					Str("request_id", requestID).
					Err(e.Err).
					Msg("request error")
			}
		}
	}
}

// RequestID middleware adds a unique request ID to each request
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" {
			requestID = generateRequestID()
		}

		c.Set("requestID", requestID)
		c.Header("X-Request-ID", requestID)
		c.Next()
	}
}

func generateRequestID() string {
	return time.Now().Format("20060102150405") + "-" + randomString(8)
}

func randomString(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[time.Now().UnixNano()%int64(len(letters))]
	}
	return string(b)
}

// Helper functions for structured logging

// Info logs at info level
func Info(msg string) {
	Logger.Info().Str("component", "api").Msg(msg)
}

// Error logs at error level
func Error(msg string, err error) {
	Logger.Error().Err(err).Str("component", "api").Msg(msg)
}

// Warn logs at warn level
func Warn(msg string) {
	Logger.Warn().Str("component", "api").Msg(msg)
}

// Debug logs at debug level
func Debug(msg string) {
	Logger.Debug().Str("component", "api").Msg(msg)
}

// WithField returns an event with a field
func WithField(key string, value interface{}) *zerolog.Event {
	return Logger.Info().Interface(key, value)
}
