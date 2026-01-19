# Build Stage
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Copy gomod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build binary
# CGO_ENABLED=0 for static binary
RUN CGO_ENABLED=0 GOOS=linux go build -o control-api main.go

# Runtime Stage
FROM alpine:latest

WORKDIR /root/

# Install CA certificates and curl for healthchecks
RUN apk --no-cache add ca-certificates curl

# Copy binary from builder
COPY --from=builder /app/control-api .

# Copy environment file (Optional: usually env vars are injected by platform)
# COPY .env .env

# Expose port (Must match PORT env var)
EXPOSE 8080

# Command to run
CMD ["./control-api"]
