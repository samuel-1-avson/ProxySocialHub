# services/control-api/Dockerfile
# Production-ready Dockerfile for Control API

# Build stage
FROM golang:1.24-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

# Create non-root user for building
RUN adduser -D -g '' appuser

# Set working directory
WORKDIR /app

# Copy go mod files first (for layer caching)
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download && go mod verify

# Copy source code
COPY . .

# Build the application
# -ldflags='-w -s' reduces binary size
# CGO_ENABLED=0 creates static binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags='-w -s -extldflags "-static"' \
    -a -installsuffix cgo \
    -tags '!dev' \
    -o server \
    main.go

# Final stage - minimal image
FROM scratch

# Import from builder
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /etc/passwd /etc/passwd

# Copy binary
COPY --from=builder /app/server /server

# Use non-root user
USER appuser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD ["/server", "-health-check"] || exit 1

# Run
ENTRYPOINT ["/server"]
