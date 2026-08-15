# GHCR web redeploy — invite-pack-20260808

**When:** 2026-08-08T22:55Z  
**Result:** Emergency VM web image replaced by GHCR pull.

## Actions

1. Tagged local `proxyhubb-web:latest` (invite banner build) → `ghcr.io/samuel-1-avson/web:invite-pack-20260808`
2. Also pushed `:latest`
3. `IMAGE_TAG=invite-pack-20260808 ./scripts/gcp-deploy-web.sh` on `proxyhubb-testnet`
4. Web healthy; apex still serves Testnet banner (“test SOL only… not trustless”)

## Notes

- Digest: `sha256:7acae0e1f250758abfc5f8973ba4cd09c140c1adbedb3181e99dc3cf3cc4c9cf`
- Prefer this tag for rollback over emergency `ALLOW_EMERGENCY_WEB_BUILD` images
- Source tree changes for the banner are on the VM and in local workspace; commit/push to git when ready so CI rebuilds match
