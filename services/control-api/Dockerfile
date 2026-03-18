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

# Copy go mod files
COPY go.mod go.sum ./

# Copy source code
COPY . .

# Remove vendor directory if present (use module mode)
RUN rm -rf vendor

# Download dependencies and build
# -ldflags='-w -s' reduces binary size
# CGO_ENABLED=0 creates static binary
RUN go mod download && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags='-w -s -extldflags "-static"' \
    -a -installsuffix cgo \
    -tags '!dev' \
    -o server \
    main.go

# Final stage - minimal image
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata wget && \
    adduser -D -g '' appuser

# Copy binary
COPY --from=builder /app/server /server

# Use non-root user
USER appuser

# Default migrations path — override with MIGRATIONS_DIR env var.
# In docker-compose the ./migrations directory is mounted at this path.
ENV MIGRATIONS_DIR=/app/migrations

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 -O /dev/null http://localhost:8080/health || exit 1

# Run
ENTRYPOINT ["/server"]
