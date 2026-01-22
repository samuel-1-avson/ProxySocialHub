FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache \
    git \
    curl \
    bash \
    openjdk11-jre \
    android-tools

# Install global packages
RUN npm install -g @expo/cli eas-cli

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Create expo user
RUN addgroup -g 1001 -S expo && \
    adduser -S expo -u 1001 -G expo

# Change ownership
RUN chown -R expo:expo /app
USER expo

# Expose ports
EXPOSE 8081 19000 19001 19002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:19000 || exit 1

# Default command
CMD ["expo", "start", "--tunnel", "--non-interactive"]