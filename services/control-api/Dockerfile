# services/control-api/Dockerfile
# Build from repository root:
#   docker build -f services/control-api/Dockerfile .

# Build stage
FROM golang:1.26-alpine AS builder

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /app

COPY services/control-api/go.mod services/control-api/go.sum ./
RUN go mod download

COPY services/control-api/ .
RUN rm -rf vendor

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags='-w -s -extldflags "-static"' \
    -a -installsuffix cgo \
    -tags '!dev' \
    -o server \
    main.go

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags='-w -s' -o custody-check ./cmd/custody-check
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags='-w -s' -o custody-rewrap ./cmd/custody-rewrap

# Final stage - minimal image
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata wget && \
    adduser -D -g '' appuser

COPY --from=builder /app/server /server
COPY --from=builder /app/custody-check /custody-check
COPY --from=builder /app/custody-rewrap /custody-rewrap
COPY migrations /app/migrations
COPY scripts/install-provider-cli.ps1 /app/static/install-provider-cli.ps1

USER appuser

ENV MIGRATIONS_DIR=/app/migrations

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 -O /dev/null http://localhost:8080/health || exit 1

ENTRYPOINT ["/server"]
