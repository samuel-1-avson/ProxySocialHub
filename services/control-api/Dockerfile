# Build stage
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Copy entire repo
COPY . .

WORKDIR /app/services/control-api

# Install dependencies
RUN go mod download

# Build binary
RUN CGO_ENABLED=0 GOOS=linux go build -o control-api main.go

# Production stage
FROM alpine:latest

WORKDIR /app

# Install ca-certificates and curl
RUN apk --no-cache add ca-certificates curl

# Copy binary from builder
COPY --from=builder /app/services/control-api/control-api .
COPY --from=builder /app/migrations ./migrations

# Expose port
EXPOSE 8080

# Run
CMD ["./control-api"]
