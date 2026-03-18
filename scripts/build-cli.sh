#!/bin/bash
# Build Provider CLI for all platforms
# Usage: ./build-cli.sh [version]
# Example: ./build-cli.sh 1.0.0

set -e

VERSION=${1:-"1.0.0"}
OUTPUT_DIR=${2:-"../cli-dist"}
CLI_DIR="../services/control-api/cmd/provider-cli"

echo "🔨 Building Provider CLI v${VERSION}..."
echo ""

# Create output directory
mkdir -p "${OUTPUT_DIR}"

# Build for Windows (AMD64)
echo "📦 Building for Windows (AMD64)..."
GOOS=windows GOARCH=amd64 go build -ldflags "-s -w -X main.version=${VERSION}" \
    -o "${OUTPUT_DIR}/provider-cli-${VERSION}-windows-amd64.exe" \
    "${CLI_DIR}"
echo "✅ Windows AMD64 build complete"

# Build for macOS (AMD64 - Intel)
echo "📦 Building for macOS (AMD64 - Intel)..."
GOOS=darwin GOARCH=amd64 go build -ldflags "-s -w -X main.version=${VERSION}" \
    -o "${OUTPUT_DIR}/provider-cli-${VERSION}-macos-amd64" \
    "${CLI_DIR}"
echo "✅ macOS AMD64 build complete"

# Build for macOS (ARM64 - Apple Silicon)
echo "📦 Building for macOS (ARM64 - Apple Silicon)..."
GOOS=darwin GOARCH=arm64 go build -ldflags "-s -w -X main.version=${VERSION}" \
    -o "${OUTPUT_DIR}/provider-cli-${VERSION}-macos-arm64" \
    "${CLI_DIR}"
echo "✅ macOS ARM64 build complete"

# Build for Linux (AMD64)
echo "📦 Building for Linux (AMD64)..."
GOOS=linux GOARCH=amd64 go build -ldflags "-s -w -X main.version=${VERSION}" \
    -o "${OUTPUT_DIR}/provider-cli-${VERSION}-linux-amd64" \
    "${CLI_DIR}"
echo "✅ Linux AMD64 build complete"

# Build for Linux (ARM64)
echo "📦 Building for Linux (ARM64)..."
GOOS=linux GOARCH=arm64 go build -ldflags "-s -w -X main.version=${VERSION}" \
    -o "${OUTPUT_DIR}/provider-cli-${VERSION}-linux-arm64" \
    "${CLI_DIR}"
echo "✅ Linux ARM64 build complete"

echo ""
echo "🎉 All builds complete!"
echo ""
echo "Output directory: ${OUTPUT_DIR}"
echo ""
echo "Files:"
ls -lh "${OUTPUT_DIR}"

echo ""
echo "Next steps:"
echo "1. Create version directory: mkdir -p ${OUTPUT_DIR}/${VERSION}"
echo "2. Move binaries: mv ${OUTPUT_DIR}/provider-cli-${VERSION}-* ${OUTPUT_DIR}/${VERSION}/"
echo "3. Upload via admin API or copy to server"
