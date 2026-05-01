# Gateway And Session Secret Rotation

Use this runbook to rotate the two RC-04 auth boundaries independently:

- `GATEWAY_SHARED_SECRET` for edge-gateway -> control-api control-plane requests
- `SESSION_SECRET` for session-intent JWT signing and validation

Do not rotate them together unless the incident scope requires it. The whole point of RC-04 is to keep the blast radius separate.

## When To Use This

- suspected leak of `GATEWAY_SHARED_SECRET`
- suspected leak of `SESSION_SECRET`
- planned quarterly secret rotation
- post-incident cleanup after auth-surface exposure

## Preconditions

- operator access to the environment secret store or `.env` source of truth
- ability to restart `control-api` and `edge-gateway`
- a non-production environment available for rehearsal before production rotation

## Generate Replacement Secrets

Generate one new value per secret:

```powershell
openssl rand -hex 32
```

Record which value is for:

- `GATEWAY_SHARED_SECRET`
- `SESSION_SECRET`

## Rotation Order

### Rotate `GATEWAY_SHARED_SECRET`

1. Update the secret source for both `control-api` and `edge-gateway`.
2. Restart `control-api` first so it begins accepting only the new gateway secret.
3. Restart `edge-gateway` immediately after so its outbound control-plane calls use the new value.
4. Confirm gateway-controlled routes recover.

Validation:

- `docker compose ps`
- `docker compose logs control-api --tail=100`
- `docker compose logs edge-gateway --tail=100`
- confirm `edge-gateway` no longer logs 401/503 errors for `/v1/gateway/*`

### Rotate `SESSION_SECRET`

1. Update the secret source for both `control-api` and `edge-gateway`.
2. Restart `control-api` first so newly issued session-intent JWTs are signed with the new secret.
3. Restart `edge-gateway` next so session-intent validation uses the same new secret.
4. Re-issue a fresh session intent after both services are healthy.

Important:

- existing session-intent JWTs signed with the old secret will stop validating after rotation
- buyer/provider users may need to recreate active sessions issued before the rotation window

Validation:

- create a fresh session intent through the web app or API
- confirm proxy auth succeeds for the new session intent
- confirm lifecycle updates still reach `/v1/gateway/session-intents/:id/state`

## Local Docker Compose Procedure

Update the root `.env` file or the environment source used by Compose, then restart the affected services:

```powershell
docker compose up -d --force-recreate control-api edge-gateway
```

If rotating only one secret, you may still restart both services to keep the pair synchronized and reduce operator error.

## Smoke Checks

### Gateway Control Plane

- `docker compose ps`
- `docker compose logs edge-gateway --tail=100`
- `docker compose logs control-api --tail=100`

Expected result:

- no repeated `Unauthorized gateway request`
- no repeated `Gateway authentication is not configured`

### Session-Intent Flow

- create a new session intent
- connect through the proxy with the new session-intent credentials
- verify usage or lifecycle updates are persisted

Expected result:

- no repeated `invalid session intent`
- no repeated `Session intent signing is not configured`

## Rollback

If validation fails:

1. restore the last known-good value for the affected secret
2. restart `control-api` and `edge-gateway`
3. confirm recovery with the same smoke checks above

Do not leave mixed old/new values deployed across the two services.

## Evidence To Capture

- timestamp of rotation
- operator who performed it
- environment rotated
- services restarted
- smoke-check result
- any user-visible session invalidation observed after `SESSION_SECRET` rotation

## Notes

- `GATEWAY_SHARED_SECRET` is a control-plane secret only
- `SESSION_SECRET` now signs session-intent delegation JWTs and must not be reused as the gateway auth secret
- production rotations should be rehearsed in non-production first to satisfy RC-04 closeout criteria
