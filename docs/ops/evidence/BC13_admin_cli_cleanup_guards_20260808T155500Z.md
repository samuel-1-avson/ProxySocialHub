# BC-13 — admin-cli destructive CleanupDb guards

| Field | Value |
|-------|--------|
| **Stamp** | 2026-08-08T15:55:00Z |
| **Component** | `services/admin-cli` |
| **Verdict** | **PASS** |

## Finding
Audit BC-13: `CleanupDb` could drop tables without an explicit operator confirmation.

## Fix
`handle_cleanup_db` refuses unless all of:

1. `PROXYHUB_ALLOW_DESTRUCTIVE_ADMIN` is truthy (`1|true|yes|on`)
2. `PROXYHUB_CONFIRM_DROP_TABLES=DROP_TABLES` (exact)
3. `APP_ENV` is not `production` / `prod`

Guard logic extracted to `cleanup_db_refusal(...)` for unit tests.

## Tests
```
cargo test --quiet   # services/admin-cli
# 4 passed (refuses without allow / without confirm / in production; allows when all pass)
```

## Residual
Ops-only Medium closed in code. No production deploy of admin-cli required for marketplace path.
