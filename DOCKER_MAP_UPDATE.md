# Docker Update Guide for Node Map Enhancement

This guide explains how to update your Docker containers to include the new Node Map enhancement components.

## Prerequisites

- Docker Desktop installed and running
- At least 4GB RAM allocated to Docker
- Node.js 20+ (for local dependency installation)

## Quick Update (Recommended)

Run the provided PowerShell script:

```powershell
# Navigate to project root
cd f:\project\proxyhubb

# Run the update script
.\update-map-docker.ps1

# Or with options:
.\update-map-docker.ps1 -Environment dev -InstallDeps
```

### Script Options

| Option | Description |
|--------|-------------|
| `-Environment` | Choose: `dev`, `prod`, or `full` (default: `dev`) |
| `-InstallDeps` | Install npm dependencies before building |
| `-SkipBuild` | Skip container rebuild (just restart) |
| `-KeepCache` | Use Docker cache (faster but may miss changes) |

## Manual Update Steps

If you prefer manual control, follow these steps:

### Step 1: Install Dependencies

```powershell
cd apps/web
npm install framer-motion three @react-three/fiber @react-three/drei recharts
cd ../..
```

### Step 2: Stop Current Web Container

```bash
docker compose -f docker-compose.dev.yml stop web
```

### Step 3: Remove Old Container

```bash
docker compose -f docker-compose.dev.yml rm -f web
```

### Step 4: Rebuild Web Container

```bash
# Clean build (recommended for major updates)
docker compose -f docker-compose.dev.yml build --no-cache web

# Or cached build (faster for minor changes)
docker compose -f docker-compose.dev.yml build web
```

### Step 5: Start Updated Container

```bash
docker compose -f docker-compose.dev.yml up -d web
```

### Step 6: Verify

```bash
# Check container status
docker compose -f docker-compose.dev.yml ps web

# View logs
docker compose -f docker-compose.dev.yml logs -f web
```

## Environment-Specific Commands

### Development

```bash
docker compose -f docker-compose.dev.yml up -d --build web
```

### Production

```bash
docker compose -f docker-compose.prod.yml up -d --build web
```

### Full Stack

```bash
docker compose -f docker-compose.full.yml up -d --build web
```

## Troubleshooting

### Issue: Build fails with "Cannot find module"

**Solution:** Install dependencies locally first:
```bash
cd apps/web
npm install
cd ../..
docker compose build --no-cache web
```

### Issue: Container exits immediately

**Solution:** Check logs for errors:
```bash
docker compose logs web
```

Common causes:
- Missing environment variables
- Port conflicts (3000 already in use)
- Build errors in Next.js

### Issue: Changes not showing

**Solution:** Force rebuild without cache:
```bash
docker compose build --no-cache web
docker compose up -d web
```

### Issue: Out of memory during build

**Solution:** Increase Docker memory limit to 4GB+ in Docker Desktop settings.

### Issue: Three.js dependencies not found

**Solution:** The new components use Three.js for 3D globe. Make sure dependencies are installed:
```bash
cd apps/web
npm install three @react-three/fiber @react-three/drei
```

## Verifying the Update

After updating, you should see:

1. **New map components** at `apps/web/src/app/explorer/map/`
2. **Enhanced UI** when visiting `http://localhost:3000/explorer/map`
3. **New features:**
   - Animated node markers with particles
   - Theme toggle (dark/light/satellite/cyberpunk/minimal)
   - 3D Globe view option
   - Connection lines between nodes
   - Detailed node panels with charts
   - Real-time activity feed
   - Advanced filters and search

## Demo Pages

Test the new components at:

- `http://localhost:3000/explorer/map/examples/EffectsDemo`
- `http://localhost:3000/explorer/map/examples/ThemeDemo`
- `http://localhost:3000/explorer/map/examples/PanelDemo`
- `http://localhost:3000/explorer/map/examples/FilterDemo`
- `http://localhost:3000/explorer/map/examples/FinalDemo`

## Rollback

If you need to rollback:

```bash
# Stop containers
docker compose -f docker-compose.dev.yml down

# Remove web image
docker rmi proxyhubb-web

# Rebuild from clean state
docker compose -f docker-compose.dev.yml up -d --build web
```

## Performance Tips

1. **Use volumes for node_modules** (in docker-compose.dev.yml):
   ```yaml
   volumes:
     - ./apps/web:/app
     - /app/node_modules
     - /app/.next
   ```

2. **Enable BuildKit** for faster builds:
   ```powershell
   $env:DOCKER_BUILDKIT=1
   ```

3. **Use BuildKit cache**:
   ```bash
   docker buildx build --cache-from type=local,src=.docker-cache --cache-to type=local,dest=.docker-cache,mode=max .
   ```

## Next Steps

After successful update:

1. Test all map features
2. Check browser console for errors
3. Verify WebSocket connections work
4. Test on different screen sizes
5. Run E2E tests if available

## Support

For issues:
1. Check container logs: `docker compose logs web`
2. Verify dependencies: `npm list framer-motion three recharts`
3. Test locally: `cd apps/web && npm run dev`
4. Review README.md in `apps/web/src/app/explorer/map/`
