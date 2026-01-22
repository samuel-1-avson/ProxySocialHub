package middleware

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/jaeger"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"go.opentelemetry.io/otel/trace"
)

// TracingConfig defines OpenTelemetry tracing configuration
type TracingConfig struct {
	// Service name for tracing
	ServiceName string
	// Service version
	ServiceVersion string
	// Environment (production, staging, development)
	Environment string
	// Jaeger endpoint (if using Jaeger)
	JaegerEndpoint string
	// OTLP endpoint (if using OTLP collector)
	OTLPEndpoint string
	// Sampling ratio (0.0 to 1.0)
	SamplingRatio float64
	// Enable debug mode
	Debug bool
}

// DefaultTracingConfig returns sensible defaults
func DefaultTracingConfig() TracingConfig {
	return TracingConfig{
		ServiceName:    "proxyhubb-control-api",
		ServiceVersion: "1.0.0",
		Environment:    "development",
		JaegerEndpoint: "http://localhost:14268/api/traces",
		OTLPEndpoint:   "",
		SamplingRatio:  1.0, // Sample everything in dev
		Debug:          true,
	}
}

// ProductionTracingConfig returns production-optimized config
func ProductionTracingConfig() TracingConfig {
	return TracingConfig{
		ServiceName:    "proxyhubb-control-api",
		ServiceVersion: "1.0.0",
		Environment:    "production",
		JaegerEndpoint: "",
		OTLPEndpoint:   "otel-collector:4317",
		SamplingRatio:  0.1, // Sample 10% in production
		Debug:          false,
	}
}

var tracer trace.Tracer

// InitTracing initializes OpenTelemetry tracing
func InitTracing(config TracingConfig) (func(), error) {
	var exporter sdktrace.SpanExporter
	var err error

	// Create exporter based on config
	if config.OTLPEndpoint != "" {
		// Use OTLP exporter
		client := otlptracegrpc.NewClient(
			otlptracegrpc.WithEndpoint(config.OTLPEndpoint),
			otlptracegrpc.WithInsecure(),
		)
		exporter, err = otlptrace.New(context.Background(), client)
	} else if config.JaegerEndpoint != "" {
		// Use Jaeger exporter
		exporter, err = jaeger.New(
			jaeger.WithCollectorEndpoint(jaeger.WithEndpoint(config.JaegerEndpoint)),
		)
	} else {
		// No exporter configured, use noop
		tracer = otel.Tracer(config.ServiceName)
		return func() {}, nil
	}

	if err != nil {
		return nil, fmt.Errorf("failed to create exporter: %w", err)
	}

	// Create resource
	res, err := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceName(config.ServiceName),
			semconv.ServiceVersion(config.ServiceVersion),
			attribute.String("environment", config.Environment),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create resource: %w", err)
	}

	// Create sampler
	var sampler sdktrace.Sampler
	if config.SamplingRatio >= 1.0 {
		sampler = sdktrace.AlwaysSample()
	} else if config.SamplingRatio <= 0.0 {
		sampler = sdktrace.NeverSample()
	} else {
		sampler = sdktrace.TraceIDRatioBased(config.SamplingRatio)
	}

	// Create trace provider
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sampler),
	)

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	tracer = tp.Tracer(config.ServiceName)

	// Return cleanup function
	cleanup := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		tp.Shutdown(ctx)
	}

	return cleanup, nil
}

// TracingMiddleware creates OpenTelemetry tracing middleware for Gin
func TracingMiddleware(serviceName string) gin.HandlerFunc {
	if tracer == nil {
		tracer = otel.Tracer(serviceName)
	}

	return func(c *gin.Context) {
		// Extract trace context from incoming request
		ctx := otel.GetTextMapPropagator().Extract(c.Request.Context(), propagation.HeaderCarrier(c.Request.Header))

		// Create span
		spanName := fmt.Sprintf("%s %s", c.Request.Method, c.FullPath())
		ctx, span := tracer.Start(ctx, spanName,
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(
				semconv.HTTPMethod(c.Request.Method),
				semconv.HTTPTarget(c.Request.URL.Path),
				semconv.HTTPRoute(c.FullPath()),
				semconv.HTTPScheme(c.Request.URL.Scheme),
				semconv.NetHostName(c.Request.Host),
				attribute.String("http.client_ip", c.ClientIP()),
				attribute.String("http.user_agent", c.Request.UserAgent()),
			),
		)
		defer span.End()

		// Store span in context
		c.Request = c.Request.WithContext(ctx)
		c.Set("tracing_span", span)
		c.Set("tracing_ctx", ctx)

		// Add trace ID to response header
		traceID := span.SpanContext().TraceID().String()
		c.Header("X-Trace-ID", traceID)

		// Process request
		c.Next()

		// Record response status
		statusCode := c.Writer.Status()
		span.SetAttributes(
			semconv.HTTPStatusCode(statusCode),
			attribute.Int("http.response_size", c.Writer.Size()),
		)

		// Set span status based on HTTP status
		if statusCode >= 400 {
			span.SetStatus(codes.Error, http.StatusText(statusCode))
			if len(c.Errors) > 0 {
				span.RecordError(c.Errors.Last().Err)
			}
		} else {
			span.SetStatus(codes.Ok, "")
		}
	}
}

// GetSpanFromContext retrieves the current span from Gin context
func GetSpanFromContext(c *gin.Context) trace.Span {
	if span, exists := c.Get("tracing_span"); exists {
		return span.(trace.Span)
	}
	return nil
}

// GetTracingContext retrieves the tracing context from Gin context
func GetTracingContext(c *gin.Context) context.Context {
	if ctx, exists := c.Get("tracing_ctx"); exists {
		return ctx.(context.Context)
	}
	return c.Request.Context()
}

// StartSpan starts a new child span
func StartSpan(c *gin.Context, name string, opts ...trace.SpanStartOption) (context.Context, trace.Span) {
	ctx := GetTracingContext(c)
	return tracer.Start(ctx, name, opts...)
}

// TraceDBQuery creates a span for database queries
func TraceDBQuery(ctx context.Context, operation, table, query string) (context.Context, trace.Span) {
	return tracer.Start(ctx, fmt.Sprintf("DB %s %s", operation, table),
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			semconv.DBSystemPostgreSQL,
			semconv.DBOperation(operation),
			semconv.DBSQLTable(table),
			attribute.String("db.statement", truncateQuery(query)),
		),
	)
}

// TraceRedisOperation creates a span for Redis operations
func TraceRedisOperation(ctx context.Context, operation, key string) (context.Context, trace.Span) {
	return tracer.Start(ctx, fmt.Sprintf("Redis %s", operation),
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			semconv.DBSystemRedis,
			semconv.DBOperation(operation),
			attribute.String("redis.key", key),
		),
	)
}

// TraceExternalHTTP creates a span for external HTTP calls
func TraceExternalHTTP(ctx context.Context, method, url, service string) (context.Context, trace.Span) {
	return tracer.Start(ctx, fmt.Sprintf("HTTP %s %s", method, service),
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			semconv.HTTPMethod(method),
			semconv.HTTPURL(url),
			attribute.String("peer.service", service),
		),
	)
}

// TraceBlockchainCall creates a span for blockchain operations
func TraceBlockchainCall(ctx context.Context, chain, operation string) (context.Context, trace.Span) {
	return tracer.Start(ctx, fmt.Sprintf("Blockchain %s %s", chain, operation),
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.String("blockchain.chain", chain),
			attribute.String("blockchain.operation", operation),
		),
	)
}

// AddSpanEvent adds an event to the current span
func AddSpanEvent(c *gin.Context, name string, attrs ...attribute.KeyValue) {
	if span := GetSpanFromContext(c); span != nil {
		span.AddEvent(name, trace.WithAttributes(attrs...))
	}
}

// SetSpanError records an error on the current span
func SetSpanError(c *gin.Context, err error) {
	if span := GetSpanFromContext(c); span != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
}

// truncateQuery truncates long queries for safety
func truncateQuery(query string) string {
	if len(query) > 200 {
		return query[:200] + "..."
	}
	return query
}

// TracingStatsHandler returns tracing statistics endpoint
func TracingStatsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		// This would typically return tracing statistics
		c.JSON(http.StatusOK, gin.H{
			"status":       "enabled",
			"service_name": "proxyhubb-control-api",
			"tracer":       "opentelemetry",
		})
	}
}
