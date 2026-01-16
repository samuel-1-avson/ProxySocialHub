# Build stage
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Install dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY . .

# Build binary
RUN CGO_ENABLED=0 GOOS=linux go build -o control-api main.go

# Production stage
FROM alpine:latest

WORKDIR /app

# Install ca-certificates for HTTPS
RUN apk --no-cache add ca-certificates

# Copy binary from builder
COPY --from=builder /app/control-api .
COPY --from=builder /app/migrations ./migrations

# Expose port
EXPOSE 8080

# Run
CMD ["./control-api"]
