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
	initTo(os.Stdout)
}

// initTo writes the logger's output to stdout, with secrets masked (see redact.go).
func initTo(stdout io.Writer) {
	env := os.Getenv("ENV")
	masked := NewRedactingWriter(stdout)

	var output io.Writer
	if env == "production" {
		// JSON output for production (log aggregation)
		output = masked
	} else {
		// Pretty console output for development
		output = zerolog.ConsoleWriter{
			Out:        masked,
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

		// Process request
		c.Next()

		// Calculate latency
		latency := time.Since(start)

		path := c.FullPath()
		if path == "" {
			path = "unmatched"
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
			Int("status", c.Writer.Status()).
			Dur("latency", latency).
			Int("body_size", c.Writer.Size()).
			Msg("request")

		// Log errors if any
		if len(c.Errors) > 0 {
			for _, e := range c.Errors {
				Logger.Error().
					Str("request_id", requestID).
					Uint64("error_type", uint64(e.Type)).
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

// Info starts a new message with info level
func Info() *zerolog.Event {
	return Logger.Info().Str("component", "api")
}

// Error starts a new message with error level
func Error(err error) *zerolog.Event {
	return Logger.Error().Err(err).Str("component", "api")
}

// Warn starts a new message with warn level
func Warn() *zerolog.Event {
	return Logger.Warn().Str("component", "api")
}

// Debug starts a new message with debug level
func Debug() *zerolog.Event {
	return Logger.Debug().Str("component", "api")
}

// WithField returns an event with a field (Legacy compatibility)
func WithField(key string, value interface{}) *zerolog.Event {
	return Logger.Info().Interface(key, value)
}
