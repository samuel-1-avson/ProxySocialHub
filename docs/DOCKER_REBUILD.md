# Docker rebuild — wallet security & API changes

All `control-api` images must be built from the **repository root** so SQL migrations (`000080`–`000082`) and the latest Go code are included.

## Prerequisites

1. Copy env template and set secrets:

```bash
cp .env.docker.example .env
# Edit .env — at minimum POSTGRES_PASSWORD, JWT_SECRET, SESSION_SECRET,
# ENCRYPTION_KEY, REDIS_PASSWORD, GATEWAY_SHARED_SECRET (dev/full stack)
```

2. Docker Compose v2 (`docker compose`).

## Development stack (API + web + migrate)

Rebuild images after backend or frontend changes:

```bash
docker compose -f docker-compose.dev.yml build --no-cache db-migrate control-api web
docker compose -f docker-compose.dev.yml up -d
```

### Navigation / settings IA (web-only)

The web app bakes `next.config.ts` redirects and `NEXT_PUBLIC_*` flags into the production image at **build** time. A running container does not pick up sidebar or `/settings` changes until you rebuild:

```powershell
.\scripts\docker-refresh-stack.ps1 -Services web
.\scripts\verify-web-docker-nav.ps1
```

Or:

```bash
docker compose -f docker-compose.dev.yml build --no-cache web
docker compose -f docker-compose.dev.yml up -d --force-recreate web
```

Hot-reload alternative (no image rebuild): run the API stack with `docker-compose.dev.yml`, then `docker compose -f docker-compose.web-dev.yml up -d --build` and open http://localhost:4001.

Migrations only (existing DB volume):

```bash
docker compose -f docker-compose.dev.yml up db-migrate
```

## Full stack

```bash
docker compose -f docker-compose.full.yml build --no-cache db-migrate control-api web
docker compose -f docker-compose.full.yml up -d
```

`control-api` waits for `db-migrate` to finish successfully before starting.

## Minimal (API + Postgres + Redis)

```bash
docker compose -f docker-compose.minimal.yml build --no-cache db-migrate control-api
docker compose -f docker-compose.minimal.yml up -d
```

## Default compose (`docker-compose.yml`)

```bash
docker compose build --no-cache db-migrate control-api
docker compose up -d
```

## Windows (PowerShell)

```powershell
.\scripts\docker-rebuild.ps1 -ComposeFile docker-compose.dev.yml
```

## Verify

- API health: `curl http://localhost:8080/health` (dev) or port from your compose file
- Migrations: see [WALLET_E2E_SMOKE.md](./WALLET_E2E_SMOKE.md) SQL checks for `000080` columns
- Web: open `http://localhost:3000` (full) or `http://localhost:3009` (dev — check `ports` in compose)

## Notes

- `./migrations` is **baked into** the image and **mounted** in compose so new migration files apply without rebuilding when you only run `db-migrate`.
- Build context is `.` (repo root); Dockerfiles live under `services/control-api/`.
- Do not build with `context: ./services/control-api` alone — migrations will be missing from the image.
