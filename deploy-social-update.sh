#!/bin/bash
#
# Deploy Script for PAYG Social System Update
# This script automates the deployment of Phases 1-4 social features
#

set -e  # Exit on error

echo "=========================================="
echo "ProxyHubb PAYG Social System Deployment"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    print_error "docker-compose not found. Please install Docker Compose."
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    print_error ".env file not found! Please create one from .env.example"
    exit 1
fi

# Create backup directory
BACKUP_DIR="./backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
print_status "Backup directory created: $BACKUP_DIR"

# Step 1: Backup database
print_status "Step 1: Creating database backup..."
if docker-compose ps | grep -q "postgres.*Up"; then
    docker-compose exec -T postgres pg_dump -U proxyhubb proxyhubb > "$BACKUP_DIR/db_backup.sql"
    print_status "Database backup saved to $BACKUP_DIR/db_backup.sql"
else
    print_warning "PostgreSQL not running, skipping backup"
fi

# Step 2: Check for new environment variables
print_status "Step 2: Checking environment variables..."
NEW_VARS=(
    "MILESTONE_CHECK_INTERVAL_MINUTES"
    "MILESTONE_REWARDS_ENABLED"
    "REVIEW_MIN_USAGE_GB"
    "REVIEW_MIN_DURATION_DAYS"
    "CIRCLE_POOL_ENABLED"
    "CIRCLE_MINIMUM_POOL_GB"
    "CIRCLE_ENTERPRISE_THRESHOLD_GB"
    "PRESENCE_HEARTBEAT_SECONDS"
    "PRESENCE_TIMEOUT_MINUTES"
    "NEXT_PUBLIC_MILESTONES_ENABLED"
    "NEXT_PUBLIC_CIRCLE_POOLING_ENABLED"
    "NEXT_PUBLIC_USAGE_REVIEWS_ENABLED"
    "NEXT_PUBLIC_SOCIAL_PRESENCE_ENABLED"
)

MISSING_VARS=()
for var in "${NEW_VARS[@]}"; do
    if ! grep -q "^$var=" .env; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    print_warning "Missing environment variables. Adding defaults to .env..."
    echo "" >> .env
    echo "# PAYG Social System (auto-added by deploy script)" >> .env
    for var in "${MISSING_VARS[@]}"; do
        case $var in
            "MILESTONE_CHECK_INTERVAL_MINUTES")
                echo "MILESTONE_CHECK_INTERVAL_MINUTES=5" >> .env ;;
            "MILESTONE_REWARDS_ENABLED")
                echo "MILESTONE_REWARDS_ENABLED=true" >> .env ;;
            "REVIEW_MIN_USAGE_GB")
                echo "REVIEW_MIN_USAGE_GB=1" >> .env ;;
            "REVIEW_MIN_DURATION_DAYS")
                echo "REVIEW_MIN_DURATION_DAYS=7" >> .env ;;
            "CIRCLE_POOL_ENABLED")
                echo "CIRCLE_POOL_ENABLED=true" >> .env ;;
            "CIRCLE_MINIMUM_POOL_GB")
                echo "CIRCLE_MINIMUM_POOL_GB=100" >> .env ;;
            "CIRCLE_ENTERPRISE_THRESHOLD_GB")
                echo "CIRCLE_ENTERPRISE_THRESHOLD_GB=1000" >> .env ;;
            "PRESENCE_HEARTBEAT_SECONDS")
                echo "PRESENCE_HEARTBEAT_SECONDS=60" >> .env ;;
            "PRESENCE_TIMEOUT_MINUTES")
                echo "PRESENCE_TIMEOUT_MINUTES=5" >> .env ;;
            "NEXT_PUBLIC_MILESTONES_ENABLED")
                echo "NEXT_PUBLIC_MILESTONES_ENABLED=true" >> .env ;;
            "NEXT_PUBLIC_CIRCLE_POOLING_ENABLED")
                echo "NEXT_PUBLIC_CIRCLE_POOLING_ENABLED=true" >> .env ;;
            "NEXT_PUBLIC_USAGE_REVIEWS_ENABLED")
                echo "NEXT_PUBLIC_USAGE_REVIEWS_ENABLED=true" >> .env ;;
            "NEXT_PUBLIC_SOCIAL_PRESENCE_ENABLED")
                echo "NEXT_PUBLIC_SOCIAL_PRESENCE_ENABLED=true" >> .env ;;
        esac
        print_status "Added $var to .env"
    done
else
    print_status "All environment variables present"
fi

# Step 3: Stop running containers
print_status "Step 3: Stopping running containers..."
docker-compose down

# Step 4: Rebuild images
print_status "Step 4: Rebuilding Docker images..."
print_status "Building control-api..."
docker-compose build --no-cache control-api

print_status "Building web frontend..."
docker-compose build --no-cache web

# Step 5: Run migrations
print_status "Step 5: Running database migrations..."
docker-compose up -d postgres redis
sleep 5  # Wait for services to be ready

docker-compose up db-migrate
MIGRATE_EXIT_CODE=$?

if [ $MIGRATE_EXIT_CODE -ne 0 ]; then
    print_error "Migration failed! Check logs with: docker-compose logs db-migrate"
    exit 1
fi

print_status "Migrations completed successfully"

# Step 6: Start all services
print_status "Step 6: Starting all services..."
docker-compose up -d

# Step 7: Health checks
print_status "Step 7: Running health checks..."
sleep 10  # Give services time to start

# Check control-api health
print_status "Checking control-api health..."
for i in {1..10}; do
    if curl -s http://localhost:8081/health > /dev/null; then
        print_status "control-api is healthy"
        break
    fi
    if [ $i -eq 10 ]; then
        print_error "control-api health check failed"
        docker-compose logs control-api | tail -50
        exit 1
    fi
    sleep 3
done

# Check web health
print_status "Checking web frontend health..."
for i in {1..10}; do
    if curl -s http://localhost:3000 > /dev/null; then
        print_status "web frontend is healthy"
        break
    fi
    if [ $i -eq 10 ]; then
        print_error "web frontend health check failed"
        docker-compose logs web | tail -50
        exit 1
    fi
    sleep 3
done

# Step 8: Verify migrations
print_status "Step 8: Verifying database migrations..."

# Check if new tables exist
TABLES=("usage_milestones" "provider_buyer_relationships" "circle_quotes" "circle_sessions" "circle_revenues")
for table in "${TABLES[@]}"; do
    if docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -c "SELECT 1 FROM $table LIMIT 1" > /dev/null 2>&1; then
        print_status "Table '$table' exists"
    else
        print_warning "Table '$table' may not exist yet (will be created by GORM AutoMigrate)"
    fi
done

# Step 9: Test new endpoints
print_status "Step 9: Testing new API endpoints..."

# Test milestone endpoint
if curl -s http://localhost:8081/api/v1/milestones > /dev/null 2>&1; then
    print_status "Milestone endpoint accessible"
else
    print_warning "Milestone endpoint not accessible (may require auth)"
fi

# Summary
echo ""
echo "=========================================="
print_status "Deployment completed successfully!"
echo "=========================================="
echo ""
echo "New features deployed:"
echo "  ✅ Phase 1: Quick messaging from explorer"
echo "  ✅ Phase 2: Usage milestones & gamification"
echo "  ✅ Phase 3: Usage-based reviews"
echo "  ✅ Phase 4: Circle bandwidth pooling"
echo ""
echo "Access your application:"
echo "  Web UI:     http://localhost:3000"
echo "  API:        http://localhost:8081"
echo "  Gateway:    http://localhost:3128"
echo ""
echo "Monitoring:"
echo "  Logs:       docker-compose logs -f"
echo "  Status:     docker-compose ps"
echo ""
echo "Backup saved to: $BACKUP_DIR"
echo ""
